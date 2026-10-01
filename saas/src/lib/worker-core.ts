import { createHash, randomUUID } from "node:crypto";
import { query, transaction, type DbClient } from "./db";
import { AppError, hashToken, isUuid } from "./core";
import { objectStorage } from "./storage";
import { jobEvent, safeWorkerInput, scheduleRetry, scopedJob, snapshotMediaAvailable, type JobRow } from "./job-core";
import { completeClipper, clipperArtifactLimit, clipperSlotAllowed,type CompletionPlan } from "./clipper-worker";
import {checkStorageQuota,additionalArtifactBytes} from './operational-limits';
import {boundedSetting,nonProductionTestAllowed} from './operational-config';

export type Worker={id:string;name:string;status:string;capabilities:string[];max_concurrency:number;available_slots:number;last_heartbeat_at:Date|null};
export type Lease={id:string;workspace_id:string;job_id:string;attempt_id:string;worker_id:string;fencing_token:string;status:string;expires_at:Date;valid:boolean};
type LeaseIdentity={jobId:string;attemptId:string;leaseId:string;fencingToken:string};
const sha=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
function textField(value:unknown,max:number,label:string){if(typeof value!=="string"||value.length>max||!/^[A-Za-z0-9 .,:;()_%+-]*$/.test(value))throw new AppError(400,`Invalid ${label}.`);return value.trim();}
function codeField(value:unknown,label:string){if(typeof value!=="string"||!/^[A-Z][A-Z0-9_]{1,79}$/.test(value))throw new AppError(400,`Invalid ${label}.`);return value;}
export function identity(raw:Record<string,unknown>,jobId:string):LeaseIdentity{
  if(!isUuid(jobId)||!isUuid(String(raw.attemptId))||!isUuid(String(raw.leaseId))||typeof raw.fencingToken!=="string"||!/^\d{1,20}$/.test(raw.fencingToken))throw new AppError(400,"Invalid lease identity.");
  return {jobId,attemptId:raw.attemptId as string,leaseId:raw.leaseId as string,fencingToken:raw.fencingToken};
}
export async function authenticateWorker(authorization:string|null){
  const raw=/^Bearer (wk_[0-9a-f-]{36}\.[A-Za-z0-9_-]{30,100})$/.exec(authorization||"")?.[1];
  if(!raw)throw new AppError(401,"Worker credential required.");
  const rows=await query<Worker>(`SELECT w.id,w.name,w.status,w.capabilities,w.max_concurrency,w.available_slots,w.last_heartbeat_at
    FROM worker_credentials c JOIN workers w ON w.id=c.worker_id
    WHERE c.token_hash=$1 AND c.revoked_at IS NULL`,[hashToken(raw)]);
  const worker=rows.rows[0];
  if(!worker||worker.status==="DISABLED")throw new AppError(401,"Worker credential unavailable.");
  return worker;
}
export async function workerCleanupState(worker:Worker,jobId:string){
  if(!isUuid(jobId))throw new AppError(404,"Job not found.");
  const r=await query<{status:string}>("SELECT j.status FROM jobs j WHERE j.id=$1 AND EXISTS(SELECT 1 FROM worker_leases l WHERE l.job_id=j.id AND l.worker_id=$2)",[jobId,worker.id]);
  if(!r.rows[0])throw new AppError(404,"Job not found.");return {safeTerminal:["SUCCEEDED","FAILED","CANCELLED"].includes(r.rows[0].status)};
}
export async function workerHeartbeat(worker:Worker,raw:Record<string,unknown>){
  const agentVersion=textField(raw.agentVersion,80,"agent version"),pipelineVersion=textField(raw.pipelineVersion||"",80,"pipeline version");
  const slots=raw.availableSlots;
  if(typeof slots!=="number"||!Number.isInteger(slots)||slots<0||slots>worker.max_concurrency)throw new AppError(400,"Invalid available slots.");
  if(raw.activeLeaseIds!==undefined&&(!Array.isArray(raw.activeLeaseIds)||raw.activeLeaseIds.length>16||raw.activeLeaseIds.some(x=>typeof x!=="string"||!isUuid(x))))throw new AppError(400,"Invalid active lease list.");
  const health=raw.clipperHealth as Record<string,unknown>|undefined;
  if(health&&(!["transcriberAvailable","ffmpegAvailable","gpuAvailable","freeDiskBytes"].every(k=>k in health)||Object.keys(health).length!==4||["transcriberAvailable","ffmpegAvailable","gpuAvailable"].some(k=>typeof health[k]!=="boolean")||typeof health.freeDiskBytes!=="number"||!Number.isSafeInteger(health.freeDiskBytes)||health.freeDiskBytes<0))throw new AppError(400,"Invalid worker health.");
  await query("UPDATE workers SET clipper_health=$1::jsonb WHERE id=$2",[JSON.stringify(health||{}),worker.id]);
  const result=await query<Worker>(`UPDATE workers SET agent_version=$1,pipeline_version=$2,available_slots=$3,last_heartbeat_at=now()
    WHERE id=$4 AND status<>'DISABLED' RETURNING id,name,status,capabilities,max_concurrency,available_slots,last_heartbeat_at`,[agentVersion,pipelineVersion,slots,worker.id]);
  return {workerId:worker.id,status:result.rows[0].status,capabilities:result.rows[0].capabilities,heartbeatIntervalSeconds:20};
}
function leaseSeconds(){return Math.max(30,Math.min(600,Number(process.env.WORKER_LEASE_SECONDS||120)));}
export async function workerClaim(worker:Worker){
  return transaction(async db=>{
    const locked=await db.query<Worker>("SELECT id,name,status,capabilities,max_concurrency,available_slots,last_heartbeat_at FROM workers WHERE id=$1 FOR UPDATE",[worker.id]);
    const own=locked.rows[0];
    if(!own||own.status!=="ACTIVE")return {claim:null,reason:"not_active"};
    if(!own.last_heartbeat_at||Date.now()-own.last_heartbeat_at.getTime()>90_000)return {claim:null,reason:"heartbeat_stale"};
    if(own.available_slots<1)return {claim:null,reason:"no_available_slots"};
    const active=await db.query<{count:string}>("SELECT count(*) FROM worker_leases WHERE worker_id=$1 AND status='ACTIVE' AND expires_at>now()",[worker.id]);
    if(Number(active.rows[0].count)>=own.max_concurrency)return {claim:null,reason:"at_capacity"};
    const health=(await db.query<{clipper_health:Record<string,unknown>}>('SELECT clipper_health FROM workers WHERE id=$1',[worker.id])).rows[0].clipper_health;
    const realClipperReady=health.transcriberAvailable===true&&health.ffmpegAvailable===true&&health.gpuAvailable===true&&typeof health.freeDiskBytes==='number'&&health.freeDiskBytes>=boundedSetting('WORKER_MIN_FREE_DISK_BYTES',5*1024**3,1,Number.MAX_SAFE_INTEGER);
    const picked=await db.query<JobRow&{attempt_id:string}>(`SELECT j.*,a.id AS attempt_id FROM jobs j
      JOIN job_attempts a ON a.workspace_id=j.workspace_id AND a.job_id=j.id AND a.attempt_number=j.attempt_count+1 AND a.status='PENDING'
      JOIN workspaces w ON w.id=j.workspace_id AND w.status='ACTIVE'
      WHERE j.type IN ('SYSTEM_TEST','CLIPPER') AND j.status='WAITING_FOR_WORKER' AND j.available_at<=now() AND $1::jsonb ? j.required_capability
      AND (j.required_capability<>'CLIPPER_V1' OR ($3 AND (j.input_snapshot->'source'->>'byteSize')::bigint*3<$4))
      AND ($5 OR j.type<>'SYSTEM_TEST' AND j.required_capability<>'CLIPPER_TEST_V1')
      AND (j.type<>'CLIPPER' OR NOT EXISTS (SELECT 1 FROM worker_leases l JOIN jobs busy ON busy.id=l.job_id WHERE l.worker_id=$2 AND l.status='ACTIVE' AND busy.type='CLIPPER'))
      ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,[JSON.stringify(own.capabilities),worker.id,realClipperReady,typeof health.freeDiskBytes==='number'?health.freeDiskBytes:0,nonProductionTestAllowed()]);
    const job=picked.rows[0];if(!job)return {claim:null,reason:"no_compatible_job"};
    if(!await snapshotMediaAvailable(job,db)){
      await db.query("UPDATE jobs SET status='FAILED',error_code='INPUT_UNAVAILABLE',error_message_safe='Required reference media is unavailable.',finished_at=now(),updated_at=now() WHERE id=$1",[job.id]);
      await db.query("UPDATE job_attempts SET status='FAILED',error_code='INPUT_UNAVAILABLE',finished_at=now() WHERE id=$1",[job.attempt_id]);
      await jobEvent(db,job.workspace_id,job.id,"JOB_FAILED",job.attempt_id,worker.id,{code:"INPUT_UNAVAILABLE"});
      return {claim:null,reason:"input_unavailable"};
    }
    const attemptNumber=job.attempt_count+1;
    const changed=await db.query("UPDATE job_attempts SET status='RUNNING',worker_id=$1,started_at=now() WHERE id=$2 AND status='PENDING' RETURNING id",[worker.id,job.attempt_id]);
    if(!changed.rows[0])return {claim:null,reason:"attempt_unavailable"};
    const lease=await db.query<{id:string;fencing_token:string;expires_at:Date}>(`INSERT INTO worker_leases(workspace_id,job_id,attempt_id,worker_id,expires_at)
      VALUES($1,$2,$3,$4,now()+($5::integer * interval '1 second')) RETURNING id,fencing_token,expires_at`,[job.workspace_id,job.id,job.attempt_id,worker.id,leaseSeconds()]);
    await db.query("UPDATE jobs SET status='RUNNING',attempt_count=$1,started_at=coalesce(started_at,now()),progress_percent=0,progress_sequence=0,progress_stage='running',progress_message='',updated_at=now() WHERE id=$2",[attemptNumber,job.id]);
    await db.query("UPDATE workers SET available_slots=greatest(0,available_slots-1) WHERE id=$1",[worker.id]);
    await jobEvent(db,job.workspace_id,job.id,"JOB_CLAIMED",job.attempt_id,worker.id,{attempt:attemptNumber});
    return {claim:{jobId:job.id,attemptId:job.attempt_id,attemptNumber,leaseId:lease.rows[0].id,fencingToken:String(lease.rows[0].fencing_token),leaseExpiresAt:lease.rows[0].expires_at,type:job.type,requiredCapability:job.required_capability,inputSnapshot:safeWorkerInput(job.input_snapshot)}};
  });
}
export async function lockedLease(db:DbClient,workerId:string,id:LeaseIdentity){
  const rows=await db.query<Lease>(`SELECT l.*,l.expires_at>now() AS valid FROM worker_leases l
    WHERE l.id=$1 AND l.job_id=$2 AND l.attempt_id=$3 AND l.worker_id=$4 FOR UPDATE`,[id.leaseId,id.jobId,id.attemptId,workerId]);
  const lease=rows.rows[0];
  if(!lease||String(lease.fencing_token)!==id.fencingToken)throw new AppError(409,"Lease is stale or unavailable.");
  return lease;
}
export function activeLease(lease:Lease){if(lease.status!=="ACTIVE"||!lease.valid)throw new AppError(409,"Lease is stale or expired.");}
export async function runningJob(db:DbClient,lease:Lease){
  const job=await scopedJob(db,lease.workspace_id,lease.job_id,true);
  if(job.status!=="RUNNING")throw new AppError(409,"Job is no longer running.");
  return job;
}
export async function workerRenew(worker:Worker,jobId:string,raw:Record<string,unknown>){
  const id=identity(raw,jobId);
  return transaction(async db=>{
    const lease=await lockedLease(db,worker.id,id);activeLease(lease);
    const job=await runningJob(db,lease);
    const renewed=await db.query<{expires_at:Date}>("UPDATE worker_leases SET expires_at=now()+($1::integer * interval '1 second'),renewed_at=now() WHERE id=$2 RETURNING expires_at",[leaseSeconds(),lease.id]);
    return {leaseExpiresAt:renewed.rows[0].expires_at,cancelRequested:!!job.cancel_requested_at};
  });
}
export async function workerProgress(worker:Worker,jobId:string,raw:Record<string,unknown>){
  const id=identity(raw,jobId),sequence=raw.sequence,percent=raw.percent;
  if(typeof sequence!=="number"||!Number.isInteger(sequence)||sequence<1||sequence>1e9||typeof percent!=="number"||!Number.isInteger(percent)||percent<0||percent>99)throw new AppError(400,"Invalid progress.");
  const stage=codeField(raw.stage,"stage").toLowerCase(),message=textField(raw.message||"",240,"progress message");
  return transaction(async db=>{
    const lease=await lockedLease(db,worker.id,id);activeLease(lease);
    const job=await runningJob(db,lease);
    const attempt=await db.query<{progress_sequence:number;progress_percent:number}>("SELECT progress_sequence,progress_percent FROM job_attempts WHERE id=$1 AND status='RUNNING' FOR UPDATE",[id.attemptId]);
    if(!attempt.rows[0])throw new AppError(409,"Attempt is no longer running.");
    if(sequence<=attempt.rows[0].progress_sequence)return {percent:attempt.rows[0].progress_percent,sequence:attempt.rows[0].progress_sequence,duplicate:true,cancelRequested:!!job.cancel_requested_at};
    if(percent<attempt.rows[0].progress_percent)throw new AppError(409,"Progress must be monotonic.");
    await db.query("UPDATE job_attempts SET progress_sequence=$1,progress_percent=$2 WHERE id=$3",[sequence,percent,id.attemptId]);
    await db.query("UPDATE jobs SET progress_sequence=$1,progress_percent=$2,progress_stage=$3,progress_message=$4,updated_at=now() WHERE id=$5",[sequence,percent,stage,message,job.id]);
    await jobEvent(db,job.workspace_id,job.id,"JOB_PROGRESS",id.attemptId,worker.id,{percent,stage});
    return {percent,sequence,duplicate:false,cancelRequested:!!job.cancel_requested_at};
  });
}
export async function workerFail(worker:Worker,jobId:string,raw:Record<string,unknown>){
  const id=identity(raw,jobId),errorCode=codeField(raw.errorCode,"error code"),message=textField(raw.message||"",240,"failure message");
  if(typeof raw.retriable!=="boolean")throw new AppError(400,"Invalid retry choice.");
  return transaction(async db=>{
    const lease=await lockedLease(db,worker.id,id);
    if(lease.status==="FAILED"||lease.status==="CANCELLED")return {status:lease.status,duplicate:true};
    activeLease(lease);
    const job=await runningJob(db,lease);
    const cancelled=!!job.cancel_requested_at||errorCode==="CANCELLED";
    await db.query("UPDATE worker_leases SET status=$1,ended_at=now() WHERE id=$2",[cancelled?"CANCELLED":"FAILED",lease.id]);
    await db.query("UPDATE job_attempts SET status=$1,error_code=$2,error_message_safe=$3,finished_at=now() WHERE id=$4",[cancelled?"CANCELLED":"FAILED",errorCode,message,id.attemptId]);
    await db.query("UPDATE workers SET available_slots=least(max_concurrency,available_slots+1) WHERE id=$1",[worker.id]);
    if(cancelled){
      await db.query("UPDATE jobs SET status='CANCELLED',cancelled_at=now(),finished_at=now(),progress_stage='cancelled',updated_at=now() WHERE id=$1",[job.id]);
      await jobEvent(db,job.workspace_id,job.id,"JOB_CANCELLED",id.attemptId,worker.id);
      return {status:"CANCELLED",duplicate:false};
    }
    await jobEvent(db,job.workspace_id,job.id,"JOB_ATTEMPT_FAILED",id.attemptId,worker.id,{code:errorCode});
    if(raw.retriable)return {status:await scheduleRetry(db,job,errorCode,id.attemptId,worker.id),duplicate:false};
    await db.query("UPDATE jobs SET status='FAILED',error_code=$1,error_message_safe=$2,finished_at=now(),progress_stage='failed',updated_at=now() WHERE id=$3",[errorCode,message,job.id]);
    await jobEvent(db,job.workspace_id,job.id,"JOB_FAILED",id.attemptId,worker.id,{code:errorCode});
    return {status:"FAILED",duplicate:false};
  });
}

async function verifiedArtifacts(db:DbClient,lease:Lease,ids:string[]){
  const rows=await db.query<{id:string;status:string;storage_key:string;mime_type:string;expected_byte_size:string;expected_sha256:string|null}>("SELECT id,status,storage_key,mime_type,expected_byte_size,expected_sha256 FROM job_artifacts WHERE workspace_id=$1 AND job_id=$2 AND attempt_id=$3 FOR UPDATE",[lease.workspace_id,lease.job_id,lease.attempt_id]);
  if(rows.rows.length!==ids.length||new Set(ids).size!==ids.length||rows.rows.some(a=>!ids.includes(a.id)))throw new AppError(409,"Completion manifest does not match approved output slots.");
  for(const artifact of rows.rows){
    if(artifact.status==="READY")continue;
    if(artifact.status!=="PENDING")throw new AppError(409,"Output slot is unavailable.");
    const head=await objectStorage().head(artifact.storage_key);
    if(!head||head.byteSize!==Number(artifact.expected_byte_size)||head.contentType!==artifact.mime_type)throw new AppError(409,"Output upload is missing or mismatched.");
    const digest=createHash("sha256");let size=0;
    for await(const chunk of await objectStorage().stream(artifact.storage_key)){size+=chunk.length;if(size>20*1024*1024)throw new AppError(413,"Output too large.");digest.update(chunk);}
    const checksum=digest.digest("hex");
    if(size!==head.byteSize||(artifact.expected_sha256&&artifact.expected_sha256!==checksum))throw new AppError(422,"Output checksum mismatch.");
    await db.query("UPDATE job_artifacts SET status='READY',byte_size=$1,sha256=$2,verified_at=now() WHERE id=$3",[size,checksum,artifact.id]);
  }
}
export async function workerComplete(worker:Worker,jobId:string,raw:Record<string,unknown>){
  const id=identity(raw,jobId),digest=raw.digest;
  const artifactIds=raw.artifactIds||[];
  if(!Array.isArray(artifactIds)||artifactIds.length>12||artifactIds.some(x=>typeof x!=="string"||!isUuid(x)))throw new AppError(400,"Invalid output manifest.");
  const plan=await transaction(async db=>{
    const lease=await lockedLease(db,worker.id,id),job=await scopedJob(db,lease.workspace_id,jobId);
    if(lease.status==='COMPLETED'&&job.status==='SUCCEEDED'||job.input_snapshot.kind!=='CLIPPER')return null;
    activeLease(lease);const row=(await db.query<{id:string;storage_key:string;sha256:string;byte_size:string}>("SELECT id,storage_key,sha256,byte_size FROM job_artifacts WHERE workspace_id=$1 AND job_id=$2 AND attempt_id=$3 AND slot_name='clip-plan' AND status='READY'",[lease.workspace_id,jobId,id.attemptId])).rows[0];
    if(!row||row.id!==raw.planArtifactId)throw new AppError(422,'Completion plan is unavailable.');return row;
  });
  let verifiedPlan:CompletionPlan|null=null;
  if(plan){const chunks:Buffer[]=[],hash=createHash('sha256');let bytes=0;for await(const chunk of await objectStorage().stream(plan.storage_key)){bytes+=chunk.length;if(bytes>20971520)throw new AppError(422,'Plan exceeds limit.');hash.update(chunk);chunks.push(Buffer.from(chunk));}if(bytes!==Number(plan.byte_size)||hash.digest('hex')!==plan.sha256)throw new AppError(422,'Completion plan checksum differs.');let document;try{document=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(422,'Invalid completion plan.');}verifiedPlan={artifactId:plan.id,sha256:plan.sha256,document};}
  return transaction(async db=>{
    const lease=await lockedLease(db,worker.id,id);
    const job=await scopedJob(db,lease.workspace_id,lease.job_id,true);
    if(lease.status==="COMPLETED"&&job.status==="SUCCEEDED")return {status:"SUCCEEDED",result:job.result,duplicate:true};
    activeLease(lease);
    if(job.status!=="RUNNING"||job.cancel_requested_at)throw new AppError(409,"Job is no longer completable.");
    if(job.input_snapshot.kind==="CLIPPER")return completeClipper(db,lease,job,raw,verifiedPlan);
    if(job.type!=="SYSTEM_TEST")throw new AppError(409,"No executor is configured for this Job type.");
    if(artifactIds.length>10)throw new AppError(400,"Invalid output manifest.");
    if(job.input_snapshot.kind==="AI_VIDEO")throw new AppError(409,"Cloud video Jobs do not use worker completion.");
    if(typeof digest!=="string"||!/^[a-f0-9]{64}$/.test(digest))throw new AppError(400,"Invalid fixture digest.");
    const expected=sha(`SYSTEM_TEST:${job.id}:${job.input_snapshot.fixture.steps}`);
    if(expected!==digest)throw new AppError(422,"Fixture result is invalid.");
    await verifiedArtifacts(db,lease,artifactIds as string[]);
    const result={digest,steps:job.input_snapshot.fixture.steps,artifactIds};
    await db.query("UPDATE worker_leases SET status='COMPLETED',ended_at=now() WHERE id=$1",[lease.id]);
    await db.query("UPDATE job_attempts SET status='SUCCEEDED',progress_percent=100,finished_at=now() WHERE id=$1",[id.attemptId]);
    await db.query("UPDATE jobs SET status='SUCCEEDED',progress_percent=100,progress_stage='complete',progress_message='Complete',result=$1::jsonb,finished_at=now(),updated_at=now() WHERE id=$2",[JSON.stringify(result),job.id]);
    await db.query("UPDATE workers SET available_slots=least(max_concurrency,available_slots+1) WHERE id=$1",[worker.id]);
    await jobEvent(db,job.workspace_id,job.id,"JOB_SUCCEEDED",id.attemptId,worker.id);
    return {status:"SUCCEEDED",result,duplicate:false};
  });
}
export async function workerAssetDownload(worker:Worker,jobId:string,raw:Record<string,unknown>){
  if(raw.storageKey!==undefined)throw new AppError(400,"Object keys are not accepted.");
  const id=identity(raw,jobId),assetVersionId=raw.assetVersionId;
  if(typeof assetVersionId!=="string"||!isUuid(assetVersionId))throw new AppError(400,"Invalid asset version.");
  return transaction(async db=>{
    const lease=await lockedLease(db,worker.id,id);activeLease(lease);
    const job=await runningJob(db,lease);
    const asset=job.input_snapshot.product?.assets.find(x=>x.assetVersionId===assetVersionId);
    if(!asset)throw new AppError(404,"Job asset not found.");
    const version=await db.query<{storage_key:string;status:string}>("SELECT storage_key,status FROM asset_versions WHERE workspace_id=$1 AND product_id=$2 AND asset_id=$3 AND id=$4",[job.workspace_id,job.input_snapshot.product!.id,asset.assetId,assetVersionId]);
    if(!version.rows[0]||version.rows[0].status!=="READY"||version.rows[0].storage_key!==asset.storageKey)throw new AppError(404,"Job asset unavailable.");
    if(!await objectStorage().head(asset.storageKey))throw new AppError(503,"Job asset is temporarily unavailable.");
    const ttl=asset.type==="VIDEO"?300:60;
    return {url:await objectStorage().issueDownload(asset.storageKey,`${assetVersionId}`,ttl),expiresInSeconds:ttl,sha256:asset.sha256,byteSize:asset.byteSize,mimeType:asset.mimeType};
  });
}
export async function workerOutputSlot(worker:Worker,jobId:string,raw:Record<string,unknown>){
  if(raw.storageKey!==undefined)throw new AppError(400,"Object keys are not accepted.");
  const id=identity(raw,jobId),slotName=raw.slotName,mimeType=raw.mimeType,byteSize=raw.byteSize,expectedSha=raw.sha256;
  if(typeof slotName!=="string"||! /^[A-Za-z0-9_-]{1,80}$/.test(slotName)||!(["application/json","image/png","video/mp4"] as unknown[]).includes(mimeType)||typeof byteSize!=="number"||!Number.isSafeInteger(byteSize)||byteSize<1||byteSize>512*1024*1024||expectedSha!=null&&(typeof expectedSha!=="string"||! /^[a-f0-9]{64}$/.test(expectedSha)))throw new AppError(400,"Invalid output slot.");
  const artifact=await transaction(async db=>{
    const lease=await lockedLease(db,worker.id,id);activeLease(lease);
    const job=await runningJob(db,lease);
    if(job.cancel_requested_at)throw new AppError(409,"Cancellation requested.");
    if(job.input_snapshot.kind==="CLIPPER"){
      if(!clipperSlotAllowed(String(slotName),String(mimeType),job.input_snapshot.targetClipCount)||Number(byteSize)>clipperArtifactLimit(String(slotName),String(mimeType)))throw new AppError(400,"Invalid Clipper output slot.");
    }else if(Number(byteSize)>20*1024*1024)throw new AppError(400,"Invalid output size.");
    const existing=await db.query<{id:string;storage_key:string;mime_type:string;expected_byte_size:string;expected_sha256:string|null;status:string}>("SELECT id,storage_key,mime_type,expected_byte_size,expected_sha256,status FROM job_artifacts WHERE attempt_id=$1 AND slot_name=$2",[id.attemptId,slotName]);
    if(existing.rows[0]){
      const row=existing.rows[0];
      if(row.mime_type!==mimeType||Number(row.expected_byte_size)!==byteSize||row.expected_sha256!==(expectedSha||null)||row.status!=="PENDING")throw new AppError(409,"Output slot already exists with different input.");
      return row;
    }
    await checkStorageQuota(db,lease.workspace_id,await additionalArtifactBytes(db,jobId,byteSize));
    const artifactId=randomUUID(),key=`pending/workspaces/${lease.workspace_id}/jobs/${jobId}/attempts/${id.attemptId}/artifacts/${artifactId}/upload`;
    const added=await db.query<{id:string;storage_key:string}>(`INSERT INTO job_artifacts(id,workspace_id,job_id,attempt_id,slot_name,storage_key,mime_type,expected_byte_size,expected_sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,storage_key`,[artifactId,lease.workspace_id,jobId,id.attemptId,slotName,key,mimeType,byteSize,expectedSha||null]);
    return added.rows[0];
  });
  return {artifactId:artifact.id,uploadUrl:await objectStorage().issueUpload(artifact.storage_key,mimeType as string,300),requiredHeaders:{"Content-Type":mimeType},expiresInSeconds:300};
}
