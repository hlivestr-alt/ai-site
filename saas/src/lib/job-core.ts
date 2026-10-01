import { createHash } from "node:crypto";
import { query, transaction, type DbClient } from "./db";
import { AppError, isUuid } from "./core";
import { objectStorage } from "./storage";

export type JobStatus="QUEUED"|"WAITING_FOR_WORKER"|"RUNNING"|"RECONCILING"|"SUCCEEDED"|"FAILED"|"CANCELLED";
export type FrozenAsset={assetId:string;assetVersionId:string;purpose:string;type:string;storageKey:string;sha256:string;byteSize:number;mimeType:string;width?:number|null;height?:number|null};
export type FrozenProduct={id:string;versionId:string;versionNumber:number;ruleVersionId:string;ruleVersionNumber:number;information:Record<string,unknown>;rules:Record<string,unknown>;assets:FrozenAsset[]};
export type SystemTestInput={schemaVersion:1;kind?:"SYSTEM_TEST";fixture:{steps:number;delayMs:number};product?:FrozenProduct};
export type AiVideoInput={schemaVersion:1;kind:"AI_VIDEO";product:FrozenProduct;customerPrompt:string;accuracyInstructions:string;tier:"QUALITY";durationSeconds:number;aspectRatio:"9:16"|"16:9"|"1:1";quantity:1;referenceAssetVersionIds:string[];providerPolicyVersion:string;executionProvider:"BYTEPLUS"|"FAKE";testScenario?:"SUCCESS"|"FAILURE"|"RATE_LIMIT"|"SUBMISSION_UNKNOWN"|"DOWNLOAD_FAIL_ONCE"|"OVERSIZED_OUTPUT"|"INVALID_MIME"|"INVALID_CHECKSUM"};
export type ClipperInput={schemaVersion:1;kind:"CLIPPER";analyzerProvider:"openai"|"fake";source:{origin:"SOURCE_ASSET";sourceAssetId:string;byteSize:number;mimeType:string;storageIdentity:string;storageKey:string;filename:string};product?:FrozenProduct;language:string;goal:string;targetClipCount:number;minClipSeconds:number;maxClipSeconds:number;aspectRatio:"9:16";captions:boolean;analyzerPolicyVersion:string;renderPolicyVersion:string};
export type JobInput=SystemTestInput|AiVideoInput|ClipperInput;
export type JobRow={id:string;workspace_id:string;type:string;required_capability:string;status:JobStatus;input_snapshot:JobInput;input_hash:string;progress_percent:number;progress_stage:string;progress_message:string;progress_sequence:number;attempt_count:number;max_attempts:number;available_at:Date;cancel_requested_at:Date|null;result:Record<string,unknown>|null};

export function inputHash(input:JobInput){return createHash("sha256").update(JSON.stringify(input)).digest("hex");}
export function safeWorkerInput(input:JobInput){
  if(input.kind==="AI_VIDEO")throw new AppError(409,"Cloud video input is not available to private workers.");
  if(input.kind==="CLIPPER"){
    const {storageKey,...source}=input.source;void storageKey;
    return {...input,source,product:input.product?{...input.product,assets:[]}:undefined};
  }
  return {kind:input.kind||"SYSTEM_TEST",schemaVersion:input.schemaVersion,fixture:input.fixture,product:input.product?{
    id:input.product.id,versionId:input.product.versionId,versionNumber:input.product.versionNumber,
    ruleVersionId:input.product.ruleVersionId,ruleVersionNumber:input.product.ruleVersionNumber,
    information:input.product.information,rules:input.product.rules,
    assets:input.product.assets.map(asset=>({assetId:asset.assetId,assetVersionId:asset.assetVersionId,purpose:asset.purpose,type:asset.type,sha256:asset.sha256,byteSize:asset.byteSize,mimeType:asset.mimeType})),
  }:undefined};
}
export async function jobEvent(db:DbClient,workspaceId:string,jobId:string,type:string,attemptId?:string|null,workerId?:string|null,data:Record<string,string|number|boolean|null>={}){
  await db.query("INSERT INTO job_events(workspace_id,job_id,attempt_id,worker_id,event_type,safe_data) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[workspaceId,jobId,attemptId||null,workerId||null,type,JSON.stringify(data)]);
}

export async function insertJob(db:DbClient,args:{workspaceId:string;createdBy:string;type:"SYSTEM_TEST"|"AI_VIDEO"|"CLIPPER";capability:string;idempotencyKey:string;input:JobInput;maxAttempts:number;requestHash?:string;billingMode?:"PAID"|"DIAGNOSTIC"}){
  const hash=inputHash(args.input),product=args.input.product;
  const created=await db.query<{id:string}>(`INSERT INTO jobs(workspace_id,type,required_capability,input_snapshot,input_hash,idempotency_key,product_id,product_version_id,product_rule_version_id,created_by,max_attempts,client_request_hash,billing_mode)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT(workspace_id,type,idempotency_key) DO NOTHING RETURNING id`,[args.workspaceId,args.type,args.capability,JSON.stringify(args.input),hash,args.idempotencyKey,product?.id||null,product?.versionId||null,product?.ruleVersionId||null,args.createdBy,args.maxAttempts,args.requestHash||null,args.billingMode||(args.type==="SYSTEM_TEST"?"DIAGNOSTIC":"PAID")]);
  if(!created.rows[0]){
    const existing=await db.query<{id:string;input_hash:string;client_request_hash:string|null;required_capability:string}>("SELECT id,input_hash,client_request_hash,required_capability FROM jobs WHERE workspace_id=$1 AND type=$2 AND idempotency_key=$3",[args.workspaceId,args.type,args.idempotencyKey]);
    if(!existing.rows[0]||(args.requestHash?existing.rows[0].client_request_hash!==args.requestHash:existing.rows[0].input_hash!==hash)||existing.rows[0].required_capability!==args.capability)throw new AppError(409,"Idempotency key was already used for different input.");
    return {id:existing.rows[0].id,existing:true};
  }
  const id=created.rows[0].id;
  await db.query("INSERT INTO job_attempts(workspace_id,job_id,attempt_number) VALUES($1,$2,1)",[args.workspaceId,id]);
  await db.query("INSERT INTO job_outbox(workspace_id,job_id,attempt_number) VALUES($1,$2,1)",[args.workspaceId,id]);
  await jobEvent(db,args.workspaceId,id,"JOB_CREATED");
  await jobEvent(db,args.workspaceId,id,"JOB_QUEUED");
  return {id,existing:false};
}

export async function scopedJob(db:DbClient,workspaceId:string,jobId:string,lock=false){
  if(!isUuid(jobId))throw new AppError(404,"Job not found.");
  const found=await db.query<JobRow>(`SELECT * FROM jobs WHERE workspace_id=$1 AND id=$2 ${lock?"FOR UPDATE":""}`,[workspaceId,jobId]);
  if(!found.rows[0])throw new AppError(404,"Job not found.");
  return found.rows[0];
}

export async function listWorkspaceJobs(workspaceId:string,options:{status?:string;page?:number}={}){
  const status=options.status||"ALL";
  if(!["ALL","QUEUED","WAITING_FOR_WORKER","RUNNING","RECONCILING","SUCCEEDED","FAILED","CANCELLED"].includes(status))throw new AppError(400,"Invalid status.");
  const page=Math.max(1,Math.min(500,Math.trunc(options.page||1)));
  const where="workspace_id=$1 AND ($2='ALL' OR status=$2)";
  const [rows,count]=await Promise.all([
    query(`SELECT id,type,status,progress_percent,progress_stage,progress_message,attempt_count,max_attempts,created_at,started_at,finished_at,error_message_safe FROM jobs WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET $3`,[workspaceId,status,(page-1)*30]),
    query<{count:string}>(`SELECT count(*) FROM jobs WHERE ${where}`,[workspaceId,status]),
  ]);
  return {jobs:rows.rows,total:Number(count.rows[0].count),page,pageSize:30};
}
export async function workspaceJobCounts(workspaceId:string){
  const rows=await query<{active:string;completed:string;failed:string}>(`SELECT
    count(*) FILTER (WHERE status IN ('QUEUED','WAITING_FOR_WORKER','RUNNING','RECONCILING')) AS active,
    count(*) FILTER (WHERE status='SUCCEEDED') AS completed,
    count(*) FILTER (WHERE status='FAILED') AS failed FROM jobs WHERE workspace_id=$1`,[workspaceId]);
  return {active:Number(rows.rows[0].active),completed:Number(rows.rows[0].completed),failed:Number(rows.rows[0].failed)};
}
export async function workspaceJobDetail(workspaceId:string,jobId:string){
  await scopedJob({query},workspaceId,jobId);
  const [job,attempts,events]=await Promise.all([
    query("SELECT id,type,status,product_id,product_version_id,product_rule_version_id,progress_percent,progress_stage,progress_message,attempt_count,max_attempts,created_at,queued_at,started_at,finished_at,cancel_requested_at,cancelled_at,error_code,error_message_safe,result FROM jobs WHERE workspace_id=$1 AND id=$2",[workspaceId,jobId]),
    query("SELECT id,attempt_number,status,progress_percent,started_at,finished_at,error_code,error_message_safe FROM job_attempts WHERE workspace_id=$1 AND job_id=$2 ORDER BY attempt_number DESC LIMIT 20",[workspaceId,jobId]),
    query("SELECT event_type,safe_data,created_at FROM job_events WHERE workspace_id=$1 AND job_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50",[workspaceId,jobId]),
  ]);
  return {job:job.rows[0],attempts:attempts.rows,events:events.rows};
}
export async function cancelWorkspaceJob(db:DbClient,workspaceId:string,jobId:string){
    const job=await scopedJob(db,workspaceId,jobId,true);
    if(["SUCCEEDED","FAILED","CANCELLED"].includes(job.status))return {id:jobId,status:job.status};
    if(job.status==="RUNNING"||(job.type==="AI_VIDEO"&&job.status==="RECONCILING")){
      await db.query("UPDATE jobs SET cancel_requested_at=coalesce(cancel_requested_at,now()),updated_at=now() WHERE workspace_id=$1 AND id=$2",[workspaceId,jobId]);
      await jobEvent(db,workspaceId,jobId,"JOB_CANCEL_REQUESTED");
      return {id:jobId,status:job.status,cancelRequested:true};
    }
    await db.query("UPDATE jobs SET status='CANCELLED',cancel_requested_at=now(),cancelled_at=now(),finished_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2",[workspaceId,jobId]);
    await db.query("UPDATE job_attempts SET status='CANCELLED',finished_at=now() WHERE workspace_id=$1 AND job_id=$2 AND status='PENDING'",[workspaceId,jobId]);
    await db.query("UPDATE job_outbox SET status='CANCELLED',processed_at=now() WHERE workspace_id=$1 AND job_id=$2 AND status='PENDING'",[workspaceId,jobId]);
    await jobEvent(db,workspaceId,jobId,"JOB_CANCELLED");
    return {id:jobId,status:"CANCELLED"};
}

export async function snapshotMediaAvailable(job:JobRow,db:DbClient={query}){
  if(job.input_snapshot.kind==="CLIPPER"){
    const source=job.input_snapshot.source;
    const found=await db.query<{storage_key:string;byte_size:string;status:string}>("SELECT storage_key,byte_size,status FROM source_assets WHERE workspace_id=$1 AND id=$2",[job.workspace_id,source.sourceAssetId]);
    const row=found.rows[0];return !!row&&["UPLOADED","VERIFIED"].includes(row.status)&&row.storage_key===source.storageKey&&Number(row.byte_size)===source.byteSize&&!!await objectStorage().head(row.storage_key);
  }
  const product=job.input_snapshot.product;
  if(!product)return true;
  for(const asset of product.assets.filter(asset=>job.input_snapshot.kind!=="AI_VIDEO"||job.input_snapshot.referenceAssetVersionIds.includes(asset.assetVersionId))){
    const version=await db.query<{storage_key:string;status:string}>("SELECT storage_key,status FROM asset_versions WHERE workspace_id=$1 AND product_id=$2 AND asset_id=$3 AND id=$4",[job.workspace_id,product.id,asset.assetId,asset.assetVersionId]);
    if(!version.rows[0]||version.rows[0].status!=="READY"||version.rows[0].storage_key!==asset.storageKey)return false;
    if(!await objectStorage().head(asset.storageKey))return false;
  }
  return true;
}
export async function dispatchOne(){
  return transaction(async db=>{
    const outbox=await db.query<{id:string;workspace_id:string;job_id:string;attempt_number:number}>(`SELECT id,workspace_id,job_id,attempt_number FROM job_outbox
      WHERE status='PENDING' AND available_at<=now() ORDER BY available_at,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const item=outbox.rows[0];if(!item)return false;
    const job=await scopedJob(db,item.workspace_id,item.job_id,true);
    if(job.status!=="QUEUED"||job.attempt_count>=job.max_attempts){
      await db.query("UPDATE job_outbox SET status='CANCELLED',processed_at=now() WHERE id=$1",[item.id]);return true;
    }
    const workspace=await db.query<{status:string}>("SELECT status FROM workspaces WHERE id=$1",[item.workspace_id]);
    const valid=workspace.rows[0]?.status==="ACTIVE"&&await snapshotMediaAvailable(job,db);
    if(!valid){
      await db.query("UPDATE jobs SET status='FAILED',error_code='INPUT_UNAVAILABLE',error_message_safe='Required workspace or reference media is unavailable.',finished_at=now(),updated_at=now() WHERE id=$1",[job.id]);
      await db.query("UPDATE job_attempts SET status='FAILED',error_code='INPUT_UNAVAILABLE',finished_at=now() WHERE job_id=$1 AND attempt_number=$2 AND status='PENDING'",[job.id,item.attempt_number]);
      await jobEvent(db,item.workspace_id,job.id,"JOB_FAILED",null,null,{code:"INPUT_UNAVAILABLE"});
    } else {
      await db.query("UPDATE jobs SET status='WAITING_FOR_WORKER',progress_stage=$1,updated_at=now() WHERE id=$2",[job.type==="AI_VIDEO"?"waiting_for_provider":"waiting_for_worker",job.id]);
      await jobEvent(db,item.workspace_id,job.id,job.type==="AI_VIDEO"?"JOB_WAITING_FOR_PROVIDER":"JOB_WAITING_FOR_WORKER");
    }
    await db.query("UPDATE job_outbox SET status='PROCESSED',processed_at=now() WHERE id=$1",[item.id]);
    return true;
  });
}
export async function dispatchBatch(limit=25){let count=0;for(;count<limit;count++)if(!await dispatchOne())break;return count;}

export async function scheduleRetry(db:DbClient,job:JobRow,reason:string,attemptId:string,workerId:string|null){
  if(job.type!=="SYSTEM_TEST"&&job.type!=="CLIPPER"){
    await db.query("UPDATE jobs SET status='RECONCILING',error_code=$1,error_message_safe='Execution outcome requires review.',updated_at=now() WHERE id=$2",[reason,job.id]);
    await jobEvent(db,job.workspace_id,job.id,"JOB_RECONCILING",attemptId,workerId,{code:reason});return "RECONCILING";
  }
  if(job.attempt_count>=job.max_attempts){
    await db.query("UPDATE jobs SET status='FAILED',error_code=$1,error_message_safe='Maximum attempts reached.',finished_at=now(),updated_at=now() WHERE id=$2",[reason,job.id]);
    await jobEvent(db,job.workspace_id,job.id,"JOB_FAILED",attemptId,workerId,{code:reason});return "FAILED";
  }
  const next=job.attempt_count+1;
  const base=Math.max(1000,Math.min(60000,Number(process.env.JOB_RETRY_BASE_MS||5000)));
  const delay=Math.min(300000,base*2**(job.attempt_count-1));
  await db.query("INSERT INTO job_attempts(workspace_id,job_id,attempt_number) VALUES($1,$2,$3)",[job.workspace_id,job.id,next]);
  await db.query("INSERT INTO job_outbox(workspace_id,job_id,attempt_number,available_at) VALUES($1,$2,$3,now()+($4::integer * interval '1 millisecond'))",[job.workspace_id,job.id,next,delay]);
  await db.query("UPDATE jobs SET status='QUEUED',available_at=now()+($1::integer * interval '1 millisecond'),progress_percent=0,progress_sequence=0,progress_stage='retry_scheduled',progress_message='',error_code=$2,error_message_safe='Retry scheduled.',updated_at=now() WHERE id=$3",[delay,reason,job.id]);
  await jobEvent(db,job.workspace_id,job.id,"JOB_RETRY_SCHEDULED",attemptId,workerId,{attempt:next,delayMs:delay});
  return "QUEUED";
}

export async function reconcileOne(){
  return transaction(async db=>{
    const lease=await db.query<{id:string;workspace_id:string;job_id:string;attempt_id:string;worker_id:string}>(`SELECT id,workspace_id,job_id,attempt_id,worker_id FROM worker_leases
      WHERE status='ACTIVE' AND expires_at<=now() ORDER BY expires_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    const item=lease.rows[0];if(!item)return false;
    const job=await scopedJob(db,item.workspace_id,item.job_id,true);
    await db.query("UPDATE worker_leases SET status='EXPIRED',ended_at=now() WHERE id=$1",[item.id]);
    await db.query("UPDATE job_attempts SET status='LOST',finished_at=now(),error_code='LEASE_EXPIRED' WHERE id=$1 AND status='RUNNING'",[item.attempt_id]);
    await jobEvent(db,item.workspace_id,item.job_id,"LEASE_EXPIRED",item.attempt_id,item.worker_id);
    if(job.status==="RUNNING"){
      if(job.cancel_requested_at){
        await db.query("UPDATE jobs SET status='CANCELLED',cancelled_at=now(),finished_at=now(),updated_at=now() WHERE id=$1",[job.id]);
        await jobEvent(db,item.workspace_id,job.id,"JOB_CANCELLED",item.attempt_id,item.worker_id);
      }else await scheduleRetry(db,job,"LEASE_EXPIRED",item.attempt_id,item.worker_id);
    }
    return true;
  });
}
export async function reconcileBatch(limit=25){let count=0;for(;count<limit;count++)if(!await reconcileOne())break;return count;}
