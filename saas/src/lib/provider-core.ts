import { transaction, type DbClient } from "./db";
import { AppError } from "./core";
import { jobEvent, scopedJob, type AiVideoInput, type JobRow } from "./job-core";
import { providerForExecution } from "./video-providers";
import { ProviderSafeError, SubmissionUnknownError, type ProviderPoll, type ProviderName } from "./video-providers/types";
import { ingestProviderOutput } from "./provider-ingest";
import {boundedSetting} from './operational-config';

type Execution={id:string;workspace_id:string;job_id:string;attempt_id:string;attempt_number:number;provider:ProviderName;model:string;provider_policy_version:string;request_hash:string;submission_token:string;state:string;external_task_id:string|null;submit_count:number;poll_count:number;ingest_count:number;submission_started_at:Date|null;submitted_at:Date|null;input_snapshot:AiVideoInput;cancel_requested_at:Date|null};
function dueMs(ms:number){return Math.max(1000,Math.min(300000,ms));}
async function markFailure(db:DbClient,e:Execution,code:string,message:string){
  const job=await scopedJob(db,e.workspace_id,e.job_id,true);
  if(["SUCCEEDED","FAILED","CANCELLED"].includes(job.status))return;
  await db.query("UPDATE provider_executions SET state='FAILED',provider_error_code=$1,safe_error=$2,completed_at=now(),updated_at=now() WHERE id=$3",[code,message,e.id]);
  await db.query("UPDATE job_attempts SET status='FAILED',error_code=$1,error_message_safe=$2,finished_at=now() WHERE id=$3 AND status='RUNNING'",[code,message,e.attempt_id]);
  await db.query("UPDATE jobs SET status='FAILED',error_code=$1,error_message_safe=$2,progress_stage='failed',finished_at=now(),updated_at=now() WHERE id=$3",[code,message,e.job_id]);
  await jobEvent(db,e.workspace_id,e.job_id,"JOB_FAILED",e.attempt_id,null,{code});
}
async function safeRetry(db:DbClient,e:Execution,code:string,message:string){
  const job=await scopedJob(db,e.workspace_id,e.job_id,true);
  if(job.attempt_count>=job.max_attempts){await markFailure(db,e,code,message);return;}
  const next=job.attempt_count+1,delay=dueMs(5000*2**(job.attempt_count-1));
  await db.query("UPDATE provider_executions SET state='FAILED',provider_error_code=$1,safe_error=$2,completed_at=now(),updated_at=now() WHERE id=$3",[code,message,e.id]);
  await db.query("UPDATE job_attempts SET status='FAILED',error_code=$1,error_message_safe=$2,finished_at=now() WHERE id=$3",[code,message,e.attempt_id]);
  await db.query("INSERT INTO job_attempts(workspace_id,job_id,attempt_number) VALUES($1,$2,$3)",[e.workspace_id,e.job_id,next]);
  await db.query("INSERT INTO job_outbox(workspace_id,job_id,attempt_number,available_at) VALUES($1,$2,$3,now()+($4::integer * interval '1 millisecond'))",[e.workspace_id,e.job_id,next,delay]);
  await db.query("UPDATE jobs SET status='QUEUED',available_at=now()+($1::integer * interval '1 millisecond'),progress_percent=0,progress_stage='retry_scheduled',progress_message='Provider is busy. Retrying shortly.',error_code=$2,error_message_safe=$3,updated_at=now() WHERE id=$4",[delay,code,message,e.job_id]);
  await jobEvent(db,e.workspace_id,e.job_id,"JOB_RETRY_SCHEDULED",e.attempt_id,null,{attempt:next,delayMs:delay});
}
export async function reserveProviderOne(jobId?:string){
  return transaction(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(731052139)');
    const global=boundedSetting('PROVIDER_MAX_CONCURRENCY',10,1,100),workspace=boundedSetting('PROVIDER_WORKSPACE_CONCURRENCY',3,1,100);
    const active=await db.query<{n:string}>("SELECT count(*) AS n FROM provider_executions WHERE state NOT IN('SUCCEEDED','FAILED','CANCELLED')");
    if(Number(active.rows[0].n)>=global)return false;
    const picked=await db.query<JobRow&{attempt_id:string;input_hash:string}>(`SELECT j.*,a.id AS attempt_id FROM jobs j JOIN job_attempts a ON a.workspace_id=j.workspace_id AND a.job_id=j.id AND a.attempt_number=j.attempt_count+1 AND a.status='PENDING'
      JOIN workspaces w ON w.id=j.workspace_id AND w.status='ACTIVE'
      WHERE j.type='AI_VIDEO' AND j.status='WAITING_FOR_WORKER' AND j.available_at<=now()
      AND ($2::uuid IS NULL OR j.id=$2)
      AND (SELECT count(*) FROM provider_executions e WHERE e.workspace_id=j.workspace_id AND e.state NOT IN('SUCCEEDED','FAILED','CANCELLED'))<$1
      ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,[workspace,jobId||null]);
    const job=picked.rows[0];if(!job)return false;
    if(job.input_snapshot.kind!=="AI_VIDEO"){
      await db.query("UPDATE jobs SET status='FAILED',error_code='INVALID_INPUT',error_message_safe='Video input is invalid.',finished_at=now() WHERE id=$1",[job.id]);return true;
    }
    const policy=await db.query<{model:string;enabled:boolean}>("SELECT model,enabled FROM provider_configurations WHERE policy_version=$1",[job.input_snapshot.providerPolicyVersion]);
    if(!policy.rows[0]){await db.query("UPDATE jobs SET status='FAILED',error_code='INVALID_INPUT',error_message_safe='Video policy is unavailable.',finished_at=now() WHERE id=$1",[job.id]);return true;}
    const provider=providerForExecution(job.input_snapshot.executionProvider);
    const attemptNumber=job.attempt_count+1;
    await db.query("UPDATE job_attempts SET status='RUNNING',started_at=now() WHERE id=$1",[job.attempt_id]);
    await db.query("UPDATE jobs SET status='RUNNING',attempt_count=$1,progress_percent=1,progress_stage='submitting',progress_message='Preparing video generation',started_at=coalesce(started_at,now()),updated_at=now() WHERE id=$2",[attemptNumber,job.id]);
    await db.query(`INSERT INTO provider_executions(workspace_id,job_id,attempt_id,attempt_number,provider,model,provider_policy_version,request_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[job.workspace_id,job.id,job.attempt_id,attemptNumber,provider.name,policy.rows[0].model,job.input_snapshot.providerPolicyVersion,job.input_hash]);
    await jobEvent(db,job.workspace_id,job.id,"PROVIDER_EXECUTION_RESERVED",job.attempt_id);
    return true;
  });
}
type Action={kind:"submit"|"reconcile"|"poll"|"ingest";execution:Execution};
async function claimDue(jobId?:string):Promise<Action|null>{
  return transaction(async db=>{
    const picked=await db.query<Execution>(`SELECT e.*,j.input_snapshot,j.cancel_requested_at FROM provider_executions e JOIN jobs j ON j.workspace_id=e.workspace_id AND j.id=e.job_id
      WHERE e.state IN ('RESERVED','SUBMITTING','SUBMISSION_UNKNOWN','SUBMITTED','RUNNING','OUTPUT_PENDING') AND e.next_action_at<=now()
      AND ($1::uuid IS NULL OR e.job_id=$1)
      ORDER BY e.next_action_at,e.created_at,e.id LIMIT 1 FOR UPDATE OF e SKIP LOCKED`,[jobId||null]);
    const e=picked.rows[0];if(!e)return null;
    if(e.input_snapshot.kind!=="AI_VIDEO")throw new AppError(500,"Invalid provider input.");
    if(e.state==="SUBMITTING"){
      await db.query("UPDATE provider_executions SET state='SUBMISSION_UNKNOWN',next_action_at=now(),updated_at=now() WHERE id=$1",[e.id]);
      await db.query("UPDATE jobs SET status='RECONCILING',progress_stage='reconciling',progress_message='Checking provider submission',updated_at=now() WHERE id=$1 AND status='RUNNING'",[e.job_id]);
      e.state="SUBMISSION_UNKNOWN";
    }
    if(e.state==="RESERVED"){
      await db.query("UPDATE provider_executions SET state='SUBMITTING',submit_count=submit_count+1,submission_started_at=now(),next_action_at=now()+interval '45 seconds',updated_at=now() WHERE id=$1",[e.id]);
      return {kind:"submit",execution:{...e,submit_count:e.submit_count+1,state:"SUBMITTING"}};
    }
    if(e.state==="SUBMISSION_UNKNOWN"){
      await db.query("UPDATE provider_executions SET next_action_at=now()+interval '60 seconds',updated_at=now() WHERE id=$1",[e.id]);
      return {kind:"reconcile",execution:e};
    }
    if(e.state==="OUTPUT_PENDING"){
      await db.query("UPDATE provider_executions SET ingest_count=ingest_count+1,next_action_at=now()+interval '10 minutes',updated_at=now() WHERE id=$1",[e.id]);
      return {kind:"ingest",execution:{...e,ingest_count:e.ingest_count+1}};
    }
    await db.query("UPDATE provider_executions SET poll_count=poll_count+1,last_polled_at=now(),next_action_at=now()+interval '30 seconds',updated_at=now() WHERE id=$1",[e.id]);
    return {kind:"poll",execution:{...e,poll_count:e.poll_count+1}};
  });
}
async function submit(e:Execution){
  const provider=providerForExecution(e.provider);
  try{
    const answer=await provider.submit(e.input_snapshot,e.model,{submissionToken:e.submission_token,attemptNumber:e.attempt_number});
    await transaction(async db=>{
      const current=await db.query<{state:string}>("SELECT state FROM provider_executions WHERE id=$1 FOR UPDATE",[e.id]);
      if(!["SUBMITTING","SUBMISSION_UNKNOWN"].includes(current.rows[0]?.state))return;
      await db.query("UPDATE provider_executions SET state='SUBMITTED',external_task_id=$1,submitted_at=coalesce(submitted_at,now()),next_action_at=now(),updated_at=now() WHERE id=$2",[answer.externalTaskId,e.id]);
      await db.query("UPDATE jobs SET status='RUNNING',progress_percent=10,progress_stage='provider_queued',progress_message='Queued with video provider',error_code=NULL,error_message_safe=NULL,updated_at=now() WHERE id=$1",[e.job_id]);
      await jobEvent(db,e.workspace_id,e.job_id,"PROVIDER_SUBMITTED",e.attempt_id);
    });
  }catch(error){
    const mapped=provider.mapError(error);
    await transaction(async db=>{
      const current=await db.query<{state:string}>("SELECT state FROM provider_executions WHERE id=$1 FOR UPDATE",[e.id]);
      if(current.rows[0]?.state!=="SUBMITTING")return;
      if(mapped instanceof SubmissionUnknownError){
        await db.query("UPDATE provider_executions SET state='SUBMISSION_UNKNOWN',provider_error_code='PROVIDER_TIMEOUT',safe_error='Checking uncertain submission.',next_action_at=now()+interval '1 second',updated_at=now() WHERE id=$1",[e.id]);
        await db.query("UPDATE jobs SET status='RECONCILING',progress_stage='reconciling',progress_message='Checking provider submission',error_code='PROVIDER_TIMEOUT',error_message_safe='Checking an uncertain provider submission.',updated_at=now() WHERE id=$1",[e.job_id]);
        await jobEvent(db,e.workspace_id,e.job_id,"PROVIDER_SUBMISSION_UNKNOWN",e.attempt_id);
      }else if(mapped.retryable)await safeRetry(db,e,mapped.code,mapped.safeMessage);
      else await markFailure(db,e,mapped.code,mapped.safeMessage);
    });
  }
}
async function reconcile(e:Execution){
  const provider=providerForExecution(e.provider);
  let externalId:string|null=null;try{externalId=await provider.findBySubmissionToken(e.submission_token);}catch{}
  if(!externalId)return;
  await transaction(async db=>{
    const current=await db.query<{state:string}>("SELECT state FROM provider_executions WHERE id=$1 FOR UPDATE",[e.id]);
    if(current.rows[0]?.state!=="SUBMISSION_UNKNOWN")return;
    await db.query("UPDATE provider_executions SET state='SUBMITTED',external_task_id=$1,submitted_at=coalesce(submitted_at,submission_started_at,now()),next_action_at=now(),provider_error_code=NULL,safe_error=NULL,updated_at=now() WHERE id=$2",[externalId,e.id]);
    await db.query("UPDATE jobs SET status='RUNNING',progress_percent=10,progress_stage='provider_queued',progress_message='Queued with video provider',error_code=NULL,error_message_safe=NULL,updated_at=now() WHERE id=$1",[e.job_id]);
    await jobEvent(db,e.workspace_id,e.job_id,"PROVIDER_SUBMISSION_RECOVERED",e.attempt_id);
  });
}
async function poll(e:Execution){
  const provider=providerForExecution(e.provider);
  if(!e.external_task_id||!e.submitted_at)throw new AppError(500,"Provider execution lacks a task ID.");
  let result:ProviderPoll;
  try{result=await provider.poll(e.external_task_id,{submittedAt:e.submitted_at,attemptNumber:e.attempt_number,testScenario:e.input_snapshot.testScenario});}
  catch(error){const mapped=provider.mapError(error);await transaction(async db=>{if(mapped instanceof ProviderSafeError&&!mapped.retryable)await markFailure(db,e,mapped.code,mapped.safeMessage);else await db.query("UPDATE provider_executions SET next_action_at=now()+($1::integer * interval '1 millisecond'),updated_at=now() WHERE id=$2 AND state IN ('SUBMITTED','RUNNING')",[dueMs(5000*2**Math.min(e.poll_count,4)),e.id]);});return;}
  if(result.status==="queued"&&e.cancel_requested_at){
    const cancelled=await provider.cancel(e.external_task_id);
    if(cancelled)result={status:"cancelled"};
  }
  await transaction(async db=>{
    const current=await db.query<{state:string}>("SELECT state FROM provider_executions WHERE id=$1 FOR UPDATE",[e.id]);
    if(!["SUBMITTED","RUNNING"].includes(current.rows[0]?.state))return;
    const job=await scopedJob(db,e.workspace_id,e.job_id,true);
    if(result.status==="failed"){await markFailure(db,e,"PROVIDER_FAILED","The video provider could not complete generation.");return;}
    if(result.status==="cancelled"){
      await db.query("UPDATE provider_executions SET state='CANCELLED',completed_at=now(),updated_at=now() WHERE id=$1",[e.id]);
      await db.query("UPDATE job_attempts SET status='CANCELLED',finished_at=now() WHERE id=$1",[e.attempt_id]);
      await db.query("UPDATE jobs SET status='CANCELLED',cancelled_at=now(),finished_at=now(),progress_stage='cancelled',updated_at=now() WHERE id=$1",[e.job_id]);
      await jobEvent(db,e.workspace_id,e.job_id,"JOB_CANCELLED",e.attempt_id);return;
    }
    if(result.status==="succeeded"){
      await db.query("UPDATE provider_executions SET state='OUTPUT_PENDING',usage_metadata=$1::jsonb,next_action_at=now(),updated_at=now() WHERE id=$2",[JSON.stringify(result.usage||{}),e.id]);
      await db.query("UPDATE jobs SET progress_percent=80,progress_stage='finalizing',progress_message='Preparing video output',updated_at=now() WHERE id=$1",[e.job_id]);
      await jobEvent(db,e.workspace_id,e.job_id,"PROVIDER_SUCCEEDED",e.attempt_id);return;
    }
    const progress=provider.normalizeProgress(result),percent=Math.max(job.progress_percent,progress.percent);
    await db.query("UPDATE provider_executions SET state=$1,next_action_at=now()+interval '5 seconds',updated_at=now() WHERE id=$2",[result.status==="running"?"RUNNING":"SUBMITTED",e.id]);
    if(percent>job.progress_percent||job.progress_stage!==progress.stage){
      await db.query("UPDATE jobs SET progress_percent=$1,progress_stage=$2,progress_message=$3,updated_at=now() WHERE id=$4",[percent,progress.stage,progress.message,e.job_id]);
      await jobEvent(db,e.workspace_id,e.job_id,"JOB_PROGRESS",e.attempt_id,null,{percent,stage:progress.stage});
    }
  });
}
async function ingest(e:Execution){
  const provider=providerForExecution(e.provider);
  if(!e.external_task_id||!e.submitted_at)throw new AppError(500,"Provider execution lacks a task ID.");
  try{
    const result=await provider.poll(e.external_task_id,{submittedAt:e.submitted_at,attemptNumber:e.attempt_number,testScenario:e.input_snapshot.testScenario});
    if(result.status!=="succeeded")throw new ProviderSafeError("OUTPUT_UNAVAILABLE","Provider output is not ready.",true);
    (result as ProviderPoll&{testScenario?:string}).testScenario=e.input_snapshot.testScenario;
    const artifact=await ingestProviderOutput({provider,poll:result,workspaceId:e.workspace_id,jobId:e.job_id,attemptId:e.attempt_id,ingestAttempt:e.ingest_count});
    await transaction(async db=>{
      const current=await db.query<{state:string}>("SELECT state FROM provider_executions WHERE id=$1 FOR UPDATE",[e.id]);
      if(current.rows[0]?.state!=="OUTPUT_PENDING")return;
      const job=await scopedJob(db,e.workspace_id,e.job_id,true);
      if(job.status==="SUCCEEDED")return;
      await db.query("UPDATE provider_executions SET state='SUCCEEDED',completed_at=now(),next_action_at=now(),updated_at=now() WHERE id=$1",[e.id]);
      await db.query("UPDATE job_attempts SET status='SUCCEEDED',progress_percent=100,finished_at=now() WHERE id=$1",[e.attempt_id]);
      await db.query("UPDATE jobs SET status='SUCCEEDED',progress_percent=100,progress_stage='complete',progress_message='Video ready',result=$1::jsonb,finished_at=now(),updated_at=now() WHERE id=$2",[JSON.stringify({artifactIds:[artifact.artifactId],durationSeconds:artifact.durationSeconds,width:artifact.width,height:artifact.height}),e.job_id]);
      await jobEvent(db,e.workspace_id,e.job_id,"JOB_SUCCEEDED",e.attempt_id);
    });
  }catch(error){
    const mapped=error instanceof ProviderSafeError?error:new ProviderSafeError("OUTPUT_UNAVAILABLE","The video result is temporarily unavailable.",true);
    await transaction(async db=>{
      const current=await db.query<{state:string}>("SELECT state FROM provider_executions WHERE id=$1 FOR UPDATE",[e.id]);
      if(current.rows[0]?.state!=="OUTPUT_PENDING")return;
      if(mapped instanceof ProviderSafeError&&mapped.retryable){
        if(e.ingest_count>=6)await markFailure(db,e,"OUTPUT_UNAVAILABLE","The video result could not be stored after retries.");
        else{
          await db.query("UPDATE provider_executions SET next_action_at=now()+interval '5 seconds',provider_error_code=$1,safe_error=$2,updated_at=now() WHERE id=$3",[mapped.code,mapped.safeMessage,e.id]);
          await db.query("UPDATE jobs SET progress_stage='finalizing',progress_message='Retrying video download',updated_at=now() WHERE id=$1",[e.job_id]);
        }
      }else await markFailure(db,e,mapped instanceof ProviderSafeError?mapped.code:"INTERNAL_ERROR",mapped instanceof ProviderSafeError?mapped.safeMessage:"Video output could not be processed.");
    });
  }
}
export async function processProviderOne(jobId?:string){
  const action=await claimDue(jobId);if(!action)return false;
  if(action.kind==="submit")await submit(action.execution);
  else if(action.kind==="reconcile")await reconcile(action.execution);
  else if(action.kind==="poll")await poll(action.execution);
  else await ingest(action.execution);
  return true;
}
export async function providerBatch(limit=10){let count=0;for(;count<limit;count++)if(!await processProviderOne())break;return count;}
export async function reserveProviderBatch(limit=10){let count=0;for(;count<limit;count++)if(!await reserveProviderOne())break;return count;}
