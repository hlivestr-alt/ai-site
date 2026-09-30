import "server-only";
import { query, transaction } from "./db";
import { AppError, isUuid } from "./core";
import { requireActiveWorkspace, getProductSnapshot } from "./products";
import { requireRole } from "./workspaces";
import { frozenProductFromSnapshot } from "./jobs";
import { insertJob, scopedJob, type ClipperInput } from "./job-core";
import { scopedSource } from "./sources";
import { clipperRequest, clipperRequestHash, ANALYZER_POLICY, RENDER_POLICY } from "./clipper-core";
import { objectStorage } from "./storage";
import type { Session } from "./auth";
export async function createClipperJob(session:Session,workspaceId:string,raw:Record<string,unknown>){
  const request=clipperRequest(raw),requestHash=clipperRequestHash(request);await requireActiveWorkspace(session,workspaceId,"future:edit");
  return transaction(async db=>{
    await requireRole(session.userId,workspaceId,"future:edit",db);
    const prior=await db.query<{id:string;client_request_hash:string}>("SELECT id,client_request_hash FROM jobs WHERE workspace_id=$1 AND type='CLIPPER' AND idempotency_key=$2",[workspaceId,request.idempotencyKey]);
    if(prior.rows[0]){if(prior.rows[0].client_request_hash!==requestHash)throw new AppError(409,"Idempotency key was already used for different input.");return {id:prior.rows[0].id,existing:true};}
    const source=await scopedSource(db,workspaceId,request.sourceAssetId);if(!["UPLOADED","VERIFIED"].includes(source.status))throw new AppError(409,"Finalize the source before clipping.");
    let product:ClipperInput["product"];
    if(request.productId){const snapshot=await getProductSnapshot(session,workspaceId,request.productId,db);if(snapshot.product.status!=="ACTIVE")throw new AppError(409,"Select an active Product.");product={...frozenProductFromSnapshot(snapshot),assets:[]};}
    const {idempotencyKey,productId,sourceAssetId,...settings}=request;void productId;
    const fake=process.env.APP_ENV==="local"&&process.env.ENABLE_FAKE_CLIP_ANALYZER==="1";
    const input:ClipperInput={schemaVersion:1,kind:"CLIPPER",analyzerProvider:fake?"fake":"openai",source:{origin:"SOURCE_ASSET",sourceAssetId,byteSize:Number(source.byte_size),mimeType:source.mime_type,storageKey:source.storage_key,storageIdentity:source.id,filename:source.original_filename},...settings,...(product?{product}:{}),analyzerPolicyVersion:ANALYZER_POLICY,renderPolicyVersion:RENDER_POLICY};
    return insertJob(db,{workspaceId,createdBy:session.userId,type:"CLIPPER",capability:fake?"CLIPPER_TEST_V1":"CLIPPER_V1",idempotencyKey,input,maxAttempts:3,requestHash});
  });
}
export async function clipperHistory(session:Session,workspaceId:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");const r=await query<{id:string;status:string;created_at:Date;finished_at:Date|null;input_snapshot:ClipperInput;result:{clips?:unknown[]}|null}>("SELECT id,status,created_at,finished_at,input_snapshot,result FROM jobs WHERE workspace_id=$1 AND type='CLIPPER' ORDER BY created_at DESC,id DESC LIMIT 50",[workspaceId]);return r.rows.map(({input_snapshot:i,result,...r})=>({...r,filename:i.source.filename,productName:i.product?.information.name||null,requested:i.targetClipCount,found:result?.clips?.length||0}));}
export async function clipperDetail(session:Session,workspaceId:string,id:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");const row=await scopedJob({query},workspaceId,id);if(row.input_snapshot.kind!=="CLIPPER")throw new AppError(404,"Clipper Job not found.");const i=row.input_snapshot;return {job:{id:row.id,status:row.status,progressPercent:row.progress_percent,stage:row.progress_stage,message:row.progress_message,cancelRequested:!!row.cancel_requested_at,source:i.source.filename,requested:i.targetClipCount,goal:i.goal,errorMessage:(row as typeof row&{error_message_safe:string|null}).error_message_safe,productName:i.product?.information.name||null,result:row.status==="SUCCEEDED"?row.result:null}};}
export async function clipperArtifactDownload(session:Session,workspaceId:string,jobId:string,id:string,attachment=false){await requireActiveWorkspace(session,workspaceId,"workspace:read");if(!isUuid(jobId)||!isUuid(id))throw new AppError(404,"Artifact not found.");const r=await query<{storage_key:string;slot_name:string;mime_type:string}>("SELECT a.storage_key,a.slot_name,a.mime_type FROM job_artifacts a JOIN jobs j ON j.workspace_id=a.workspace_id AND j.id=a.job_id WHERE a.workspace_id=$1 AND a.job_id=$2 AND a.id=$3 AND a.status='READY' AND j.type='CLIPPER' AND j.status='SUCCEEDED' AND j.result->'artifactIds' ? a.id::text",[workspaceId,jobId,id]);const a=r.rows[0];if(!a)throw new AppError(404,"Artifact not found.");return {url:await objectStorage().issueDownload(a.storage_key,`${a.slot_name}.${a.mime_type==="video/mp4"?"mp4":"json"}`,300,attachment),expiresInSeconds:300};}
