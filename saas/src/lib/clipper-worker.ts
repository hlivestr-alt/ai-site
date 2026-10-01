import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError, isUuid } from "./core";
import { query, transaction, type DbClient } from "./db";
import { objectStorage } from "./storage";
import { identity, lockedLease, activeLease, runningJob, type Worker, type Lease } from "./worker-core";
import { jobEvent, type JobRow, type ClipperInput } from "./job-core";
import { validatedClips } from "./clipper-core";
import {checkStorageQuota} from './operational-limits';
type Artifact={id:string;attempt_id:string;slot_name:string;status:string;storage_key:string;mime_type:string;expected_byte_size:string;expected_sha256:string|null;sha256:string;byte_size:string;duration_seconds:string|null;width:number|null;height:number|null};
export function clipperArtifactLimit(slot:string,mime:string){if(mime==="video/mp4"){const n=Number(process.env.MAX_CLIPPER_OUTPUT_BYTES||268435456);return Number.isSafeInteger(n)?Math.min(536870912,Math.max(1048576,n)):268435456;}return slot==="transcript"?67108864:20971520;}
export function clipperSlotAllowed(slot:string,mime:string,count:number){if(slot==="transcript"||slot==="clip-plan")return mime==="application/json";const match=/^clip_(\d{3})$/.exec(slot);return mime==="video/mp4"&&!!match&&Number(match[1])>=1&&Number(match[1])<=count;}
async function current(worker:Worker,jobId:string,raw:Record<string,unknown>,db:DbClient){const l=await lockedLease(db,worker.id,identity(raw,jobId));activeLease(l);const j=await runningJob(db,l);if(j.cancel_requested_at)throw new AppError(409,"Cancellation requested.");if(j.input_snapshot.kind!=="CLIPPER")throw new AppError(409,"Clipper executor required.");return {lease:l,job:j,input:j.input_snapshot};}
async function sourceFor(db:DbClient,job:JobRow,input:ClipperInput,sourceId:unknown,lock=false){if(sourceId!==input.source.sourceAssetId)throw new AppError(404,"Job source not found.");const r=await db.query<{storage_key:string;status:string;byte_size:string;sha256:string|null;duration_seconds:number|null}>(`SELECT storage_key,status,byte_size,sha256,duration_seconds FROM source_assets WHERE workspace_id=$1 AND id=$2 ${lock?"FOR UPDATE":""}`,[job.workspace_id,sourceId]);const s=r.rows[0];if(!s||!["UPLOADED","VERIFIED"].includes(s.status)||s.storage_key!==input.source.storageKey||Number(s.byte_size)!==input.source.byteSize)throw new AppError(404,"Job source unavailable.");return s;}
export async function workerSourceDownload(worker:Worker,jobId:string,raw:Record<string,unknown>){if(raw.storageKey!==undefined)throw new AppError(400,"Object keys are not accepted.");return transaction(async db=>{const {job,input}=await current(worker,jobId,raw,db);const s=await sourceFor(db,job,input,raw.sourceAssetId);const h=await objectStorage().head(s.storage_key);if(!h||h.byteSize!==input.source.byteSize)throw new AppError(503,"Source unavailable.");return {url:await objectStorage().issueDownload(s.storage_key,"source.mp4",300),expiresInSeconds:300,byteSize:input.source.byteSize,sha256:s.sha256,mimeType:"video/mp4"};});}
export async function workerSourceVerified(worker:Worker,jobId:string,raw:Record<string,unknown>){return transaction(async db=>{
  const {job,input}=await current(worker,jobId,raw,db);const s=await sourceFor(db,job,input,raw.sourceAssetId,true);
  if(typeof raw.sha256!=="string"||! /^[a-f0-9]{64}$/.test(raw.sha256)||raw.byteSize!==input.source.byteSize||typeof raw.durationSeconds!=="number"||!Number.isFinite(raw.durationSeconds)||raw.durationSeconds<=0||raw.durationSeconds>=86400||![raw.width,raw.height].every(n=>typeof n==="number"&&Number.isInteger(n)&&n>0&&n<=16384)||raw.hasAudio!==true)throw new AppError(422,"Source verification failed.");
  if(s.sha256&&s.sha256!==raw.sha256)throw new AppError(422,"Source checksum mismatch.");
  if(s.status==="VERIFIED"&&Math.abs(Number(s.duration_seconds)-raw.durationSeconds)>0.05)throw new AppError(422,"Source probe differs from verified identity.");
  await db.query("UPDATE source_assets SET status='VERIFIED',sha256=$1,duration_seconds=$2,width=$3,height=$4,verified_at=coalesce(verified_at,now()) WHERE workspace_id=$5 AND id=$6",[raw.sha256,raw.durationSeconds,raw.width,raw.height,job.workspace_id,raw.sourceAssetId]);await jobEvent(db,job.workspace_id,jobId,"SOURCE_VERIFIED",raw.attemptId as string,worker.id);return {status:"VERIFIED"};
});}
export async function workerFinalizeArtifact(worker:Worker,jobId:string,raw:Record<string,unknown>){
  if(typeof raw.artifactId!=="string"||!isUuid(raw.artifactId))throw new AppError(400,"Invalid artifact.");
  const prepared=await transaction(async db=>{const c=await current(worker,jobId,raw,db);const r=await db.query<Artifact>("SELECT * FROM job_artifacts WHERE workspace_id=$1 AND job_id=$2 AND attempt_id=$3 AND id=$4",[c.job.workspace_id,jobId,c.lease.attempt_id,raw.artifactId]);const a=r.rows[0];if(!a||!clipperSlotAllowed(a.slot_name,a.mime_type,c.input.targetClipCount))throw new AppError(404,"Artifact not found.");if(a.status!=='READY')await checkStorageQuota(db,c.job.workspace_id);const s=await sourceFor(db,c.job,c.input,c.input.source.sourceAssetId);if(s.status!=="VERIFIED")throw new AppError(409,"Verify source first.");return {...c,artifact:a,source:s};});
  const a=prepared.artifact;if(a.status==="READY")return {artifactId:a.id,status:"READY",sha256:a.sha256};if(a.status!=="PENDING")throw new AppError(409,"Artifact unavailable.");
  const storage=objectStorage(),head=await storage.head(a.storage_key),maximum=clipperArtifactLimit(a.slot_name,a.mime_type);
  if(!head||head.byteSize!==Number(a.expected_byte_size)||head.byteSize>maximum||head.contentType!==a.mime_type)throw new AppError(409,"Artifact upload missing or mismatched.");
  const sealed=`workspaces/${prepared.job.workspace_id}/jobs/${jobId}/attempts/${prepared.lease.attempt_id}/artifacts/${a.id}/original`;
  await storage.copy(a.storage_key,sealed,head.etag,a.mime_type);
  const folder=await mkdtemp(join(tmpdir(),"saas-clipper-")),path=join(folder,"output");
  try{
    const f=await open(path,"wx"),hash=createHash("sha256");let size=0;
    try{for await(const chunk of await storage.stream(sealed)){size+=chunk.length;if(size>maximum)throw new AppError(413,"Artifact exceeds its limit.");hash.update(chunk);let offset=0;while(offset<chunk.length){const w=await f.write(chunk,offset,chunk.length-offset);if(!w.bytesWritten)throw new AppError(503,"Artifact verification unavailable.");offset+=w.bytesWritten;}}}finally{await f.close();}
    const sha256=hash.digest("hex");if(size!==head.byteSize||!a.expected_sha256||sha256!==a.expected_sha256)throw new AppError(422,"Artifact checksum mismatch.");
    let document:Record<string,unknown>|undefined,duration:number|null=null,width:number|null=null,height:number|null=null;
    if(a.mime_type==="application/json"){
      try{document=JSON.parse(await readFile(path,"utf8"));}catch{throw new AppError(422,"Invalid JSON artifact.");}
      if(!document||document.sourceAssetId!==prepared.input.source.sourceAssetId||document.sourceSha256!==prepared.source.sha256)throw new AppError(422,"Artifact source lineage mismatch.");
      if(a.slot_name==="transcript"){
        if(document.schemaVersion!==3||document.duration!==prepared.source.duration_seconds||!Array.isArray(document.segments)||document.segments.length<1||document.segments.length>500000)throw new AppError(422,"Invalid transcript schema.");
        for(const s of document.segments as Record<string,unknown>[]){if(typeof s.start!=="number"||typeof s.end!=="number"||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>Number(document.duration)+0.05||typeof s.text!=="string"||s.text.length>16000)throw new AppError(422,"Invalid transcript timing.");}
      }else{
        if(document.schemaVersion!==1||document.inputHash!==prepared.job.input_hash||document.analyzerPolicyVersion!==prepared.input.analyzerPolicyVersion||!Array.isArray(document.clips)||!isUuid(String(document.transcriptArtifactId)))throw new AppError(422,"Invalid plan schema.");
        const transcript=await query("SELECT id FROM job_artifacts WHERE workspace_id=$1 AND job_id=$2 AND attempt_id=$3 AND id=$4 AND slot_name='transcript' AND status='READY'",[prepared.job.workspace_id,jobId,prepared.lease.attempt_id,document.transcriptArtifactId]);if(!transcript.rowCount)throw new AppError(422,"Plan transcript is unavailable.");
        const dummy=(document.clips as Record<string,unknown>[]).map((c,i)=>({...c,artifactId:`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`,duration:Number(c.end)-Number(c.start),width:720,height:1280,sha256:"0".repeat(64)}));validatedClips(dummy,prepared.input,Number(prepared.source.duration_seconds));
      }
    }else{
      try{const r=await promisify(execFile)(process.env.FFPROBE_PATH||"ffprobe",["-v","error","-show_streams","-show_format","-of","json",path],{timeout:30000,maxBuffer:65536});const p=JSON.parse(r.stdout),v=p.streams?.find((s:{codec_type:string})=>s.codec_type==="video");duration=Number(p.format?.duration);width=v?.width;height=v?.height;if(v?.codec_name!=="h264"||width!==720||height!==1280||!Number.isFinite(duration)||duration!<prepared.input.minClipSeconds-0.3||duration!>prepared.input.maxClipSeconds+0.3)throw new Error();}catch{throw new AppError(422,"Rendered clip validation failed.");}
    }
    return await transaction(async db=>{
      const c=await current(worker,jobId,raw,db);await checkStorageQuota(db,c.job.workspace_id);const locked=await db.query<Artifact>("SELECT * FROM job_artifacts WHERE id=$1 AND attempt_id=$2 FOR UPDATE",[a.id,c.lease.attempt_id]);if(locked.rows[0].status==="READY")return {artifactId:a.id,status:"READY",sha256:locked.rows[0].sha256};
      await db.query("UPDATE job_artifacts SET status='READY',storage_key=$1,byte_size=$2,sha256=$3,duration_seconds=$4,width=$5,height=$6,verified_at=now() WHERE id=$7",[sealed,size,sha256,duration,width,height,a.id]);
      const stage=a.slot_name==="transcript"?"TRANSCRIPT_READY":a.slot_name==="clip-plan"?"PLAN_READY":"OUTPUTS_READY";
      await db.query("INSERT INTO clipper_checkpoints(workspace_id,job_id,stage,slot_name,artifact_id,input_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(job_id,slot_name) DO UPDATE SET artifact_id=excluded.artifact_id,created_at=now()",[c.job.workspace_id,jobId,stage,a.slot_name,a.id,c.job.input_hash]);await jobEvent(db,c.job.workspace_id,jobId,stage,c.lease.attempt_id,worker.id);return {artifactId:a.id,status:"READY",sha256};
    });
  }finally{await rm(path,{force:true});await rm(folder,{recursive:true,force:true});}
}
export async function workerCheckpoints(worker:Worker,jobId:string,raw:Record<string,unknown>){return transaction(async db=>{const c=await current(worker,jobId,raw,db);const r=await db.query<Artifact&{stage:string}>("SELECT a.*,cp.stage FROM clipper_checkpoints cp JOIN job_artifacts a ON a.workspace_id=cp.workspace_id AND a.job_id=cp.job_id AND a.id=cp.artifact_id WHERE cp.workspace_id=$1 AND cp.job_id=$2 AND cp.input_hash=$3 AND a.status='READY' ORDER BY cp.slot_name",[c.job.workspace_id,jobId,c.job.input_hash]);return {inputHash:c.job.input_hash,checkpoints:await Promise.all(r.rows.map(async a=>({slotName:a.slot_name,attemptId:a.attempt_id,stage:a.stage,artifactId:a.id,sha256:a.sha256,byteSize:Number(a.byte_size),url:await objectStorage().issueDownload(a.storage_key,a.slot_name,300)})))};});}
export type CompletionPlan={artifactId:string;sha256:string;document:Record<string,unknown>};
export async function completeClipper(db:DbClient,lease:Lease,job:JobRow,raw:Record<string,unknown>,verifiedPlan:CompletionPlan|null){
  if(job.input_snapshot.kind!=="CLIPPER")throw new AppError(409,"Clipper input required.");const input=job.input_snapshot;
  const s=await sourceFor(db,job,input,input.source.sourceAssetId);if(s.status!=="VERIFIED")throw new AppError(409,"Source is not verified.");
  const clips=validatedClips(raw.clips,input,Number(s.duration_seconds));const ids=raw.artifactIds as string[];
  const r=await db.query<Artifact>("SELECT * FROM job_artifacts WHERE workspace_id=$1 AND job_id=$2 AND attempt_id=$3 FOR UPDATE",[job.workspace_id,job.id,lease.attempt_id]);
  const transcript=r.rows.find(a=>a.slot_name==="transcript"),plan=r.rows.find(a=>a.slot_name==="clip-plan");
  if(!transcript||!plan||r.rows.length!==clips.length+2||ids.length!==r.rows.length||new Set(ids).size!==ids.length||r.rows.some(a=>a.status!=="READY"||!ids.includes(a.id))||raw.transcriptArtifactId!==transcript.id||raw.planArtifactId!==plan.id)throw new AppError(422,"Completion artifacts are incomplete.");
  for(let i=0;i<clips.length;i++){const c=clips[i],a=r.rows.find(a=>a.id===c.artifactId);if(!a||a.slot_name!==`clip_${String(i+1).padStart(3,"0")}`||a.sha256!==c.sha256||Math.abs(Number(a.duration_seconds)-c.duration)>0.3||a.width!==c.width||a.height!==c.height)throw new AppError(422,"Clip manifest differs from verified media.");}
  // Byte retrieval was verified before entering this transaction; revalidate its immutable identity.
  if(!verifiedPlan||verifiedPlan.artifactId!==plan.id||verifiedPlan.sha256!==plan.sha256)throw new AppError(422,'Completion plan identity differs.');
  const p=verifiedPlan.document as {transcriptArtifactId:string;clips:Record<string,unknown>[]};
  if(p.transcriptArtifactId!==transcript.id||p.clips.length!==clips.length||p.clips.some((v:Record<string,unknown>,i:number)=>["start","end","score","hook","reason","tags"].some(k=>JSON.stringify(v[k])!==JSON.stringify(clips[i][k as keyof typeof clips[number]]))))throw new AppError(422,"Completion differs from approved plan.");
  const result={schemaVersion:1,sourceAssetId:input.source.sourceAssetId,sourceSha256:s.sha256,transcriptArtifactId:transcript.id,planArtifactId:plan.id,artifactIds:ids,requestedClipCount:input.targetClipCount,clips,analyzerPolicyVersion:input.analyzerPolicyVersion,renderPolicyVersion:input.renderPolicyVersion,pipelineVersion:"clipper-v1"};
  await db.query("UPDATE worker_leases SET status='COMPLETED',ended_at=now() WHERE id=$1",[lease.id]);await db.query("UPDATE job_attempts SET status='SUCCEEDED',progress_percent=100,finished_at=now() WHERE id=$1",[lease.attempt_id]);await db.query("UPDATE jobs SET status='SUCCEEDED',progress_percent=100,progress_stage='complete',progress_message='Complete',error_code=NULL,error_message_safe=NULL,result=$1::jsonb,finished_at=now(),updated_at=now() WHERE id=$2",[JSON.stringify(result),job.id]);await db.query("UPDATE workers SET available_slots=least(max_concurrency,available_slots+1) WHERE id=$1",[lease.worker_id]);await jobEvent(db,job.workspace_id,job.id,"JOB_SUCCEEDED",lease.attempt_id,lease.worker_id);return {status:"SUCCEEDED",result,duplicate:false};
}
