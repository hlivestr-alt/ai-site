import "server-only";
import { createHash } from "node:crypto";
import { query, transaction, type DbClient } from "./db";
import { AppError, isUuid } from "./core";
import { requireRole } from "./workspaces";
import { getProductSnapshot, requireActiveWorkspace } from "./products";
import { frozenProductFromSnapshot } from "./jobs";
import { activeJobStatuses,type AiVideoInput } from "./job-core";
import { customerVideoOptions, fakeEnabled } from "./video-providers";
import {createQuote,lockWallet,jobBilling} from "./billing-core";
import { objectStorage } from "./storage";
import type { Session } from "./auth";

import {parseAiVideoRequest as parseRequest,customerVideoScenario as customerScenario,prepareAiVideoInput,diagnosticVideoScenario} from "./video-operation";
import {admitOperation} from "./paid-operations";
export {diagnosticVideoScenario} from "./video-operation";
async function prepareAiVideo(db:DbClient,session:Session,workspaceId:string,input:ReturnType<typeof parseRequest>,scenario?:ReturnType<typeof diagnosticVideoScenario>){
 const snapshot=await getProductSnapshot(session,workspaceId,input.productId,db);
 if(snapshot.product.status!=="ACTIVE")throw new AppError(409,"Select an active Product.");
 return prepareAiVideoInput(db,input,frozenProductFromSnapshot(snapshot),scenario);
}
export async function quoteAiVideo(session:Session,workspaceId:string,raw:Record<string,unknown>){const input=parseRequest({...raw,idempotencyKey:raw.idempotencyKey||"quote-request"},customerScenario(raw));const requestHash=createHash("sha256").update(JSON.stringify({productId:input.productId,prompt:input.prompt,tier:input.tier,durationSeconds:input.durationSeconds,aspectRatio:input.aspectRatio,quantity:input.quantity,referenceAssetVersionIds:input.referenceAssetVersionIds,scenario:input.scenario||null})).digest("hex");await requireActiveWorkspace(session,workspaceId,"future:spend");return transaction(async db=>{await requireRole(session.userId,workspaceId,"future:spend",db);return createQuote(db,workspaceId,session.userId,"AI_VIDEO",await prepareAiVideo(db,session,workspaceId,input,input.scenario),requestHash);});}
export async function createAiVideoJob(session:Session,workspaceId:string,raw:Record<string,unknown>,scenario?:ReturnType<typeof diagnosticVideoScenario>){
  if(scenario&&!fakeEnabled())throw new AppError(404,"Not found.");
  const input=parseRequest(raw,scenario||customerScenario(raw)),requestHash=createHash("sha256").update(JSON.stringify({productId:input.productId,prompt:input.prompt,tier:input.tier,durationSeconds:input.durationSeconds,aspectRatio:input.aspectRatio,quantity:input.quantity,referenceAssetVersionIds:input.referenceAssetVersionIds,scenario:input.scenario||null})).digest("hex");
  await requireActiveWorkspace(session,workspaceId,"future:spend");
  return transaction(async db=>{
    await requireRole(session.userId,workspaceId,"future:spend",db);
    if(!scenario)await lockWallet(db,workspaceId);
    const prior=await db.query<{id:string;client_request_hash:string|null;billing_mode:string}>("SELECT id,client_request_hash,billing_mode FROM jobs WHERE workspace_id=$1 AND type='AI_VIDEO' AND idempotency_key=$2",[workspaceId,input.idempotencyKey]);
    if(prior.rows[0]){
      if((prior.rows[0].billing_mode==="DIAGNOSTIC")!==!!scenario||prior.rows[0].client_request_hash!==requestHash)throw new AppError(409,"Idempotency key was already used for different input.");
      return {id:prior.rows[0].id,existing:true};
    }
    const frozen=await prepareAiVideo(db,session,workspaceId,input,input.scenario);
    return admitOperation(db,{workspaceId,userId:session.userId,input:frozen,requestHash,key:input.idempotencyKey,quote:raw,diagnostic:!!scenario});
  });
}
export async function aiVideoOptions(session:Session,workspaceId:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");return customerVideoOptions();}
export async function latestActiveAiVideo(session:Session,workspaceId:string){
  await requireActiveWorkspace(session,workspaceId,'workspace:read');
  return (await query<{id:string}>("SELECT id FROM jobs WHERE workspace_id=$1 AND type='AI_VIDEO' AND status=ANY($2::text[]) ORDER BY created_at DESC,id DESC LIMIT 1",[workspaceId,activeJobStatuses])).rows[0]||null;
}
export async function aiVideoProducts(session:Session,workspaceId:string){
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  const rows=await query<{id:string;name:string;brand:string;version_number:number}>(`SELECT p.id,v.name,v.brand,v.version_number FROM products p JOIN product_versions v ON v.id=p.current_version_id AND v.workspace_id=p.workspace_id AND v.product_id=p.id
    WHERE p.workspace_id=$1 AND p.status='ACTIVE' ORDER BY v.name,p.id LIMIT 500`,[workspaceId]);
  return rows.rows;
}
export async function aiVideoHistory(session:Session,workspaceId:string){
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  const rows=await query<{id:string;status:string;progress_percent:number;progress_stage:string;created_at:Date;finished_at:Date|null;input_snapshot:AiVideoInput}>("SELECT id,status,progress_percent,progress_stage,created_at,finished_at,input_snapshot FROM jobs WHERE workspace_id=$1 AND type='AI_VIDEO' ORDER BY created_at DESC,id DESC LIMIT 50",[workspaceId]);
  return rows.rows.map(({input_snapshot:input,...row})=>({...row,productName:String(input.product.information.name||"Product"),productVersion:input.product.versionNumber,tier:input.tier,durationSeconds:input.durationSeconds,aspectRatio:input.aspectRatio}));
}
export async function aiVideoDetail(session:Session,workspaceId:string,jobId:string){
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  if(!isUuid(jobId))throw new AppError(404,"Video Job not found.");
  const rows=await query<{id:string;status:string;progress_percent:number;progress_stage:string;progress_message:string;error_message_safe:string|null;created_at:Date;started_at:Date|null;finished_at:Date|null;cancel_requested_at:Date|null;input_snapshot:AiVideoInput}>("SELECT id,status,progress_percent,progress_stage,progress_message,error_message_safe,created_at,started_at,finished_at,cancel_requested_at,input_snapshot FROM jobs WHERE workspace_id=$1 AND id=$2 AND type='AI_VIDEO'",[workspaceId,jobId]);
  const row=rows.rows[0];if(!row)throw new AppError(404,"Video Job not found.");
  const input=row.input_snapshot;
  const artifacts=await query<{id:string;mime_type:string;byte_size:string;sha256:string;created_at:Date}>("SELECT id,mime_type,byte_size,sha256,created_at FROM job_artifacts WHERE workspace_id=$1 AND job_id=$2 AND status='READY' ORDER BY created_at,id",[workspaceId,jobId]);
  return {job:{billing:await jobBilling(workspaceId,jobId),id:row.id,status:row.status,progressPercent:row.progress_percent,progressStage:row.progress_stage,progressMessage:row.progress_message,errorMessage:row.error_message_safe,createdAt:row.created_at,startedAt:row.started_at,finishedAt:row.finished_at,cancelRequested:!!row.cancel_requested_at,prompt:input.customerPrompt,productId:input.product.id,productName:String(input.product.information.name||"Product"),productVersionId:input.product.versionId,productVersion:input.product.versionNumber,ruleVersion:input.product.ruleVersionNumber,tier:input.tier,durationSeconds:input.durationSeconds,aspectRatio:input.aspectRatio,referenceAssetVersionIds:input.referenceAssetVersionIds,artifacts:artifacts.rows.map(x=>({id:x.id,mimeType:x.mime_type,byteSize:Number(x.byte_size),sha256:x.sha256,createdAt:x.created_at}))}};
}
export async function aiVideoArtifactDownload(session:Session,workspaceId:string,jobId:string,artifactId:string){
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  if(!isUuid(jobId)||!isUuid(artifactId))throw new AppError(404,"Video artifact not found.");
  const rows=await query<{storage_key:string;byte_size:string;sha256:string;mime_type:string}>(`SELECT a.storage_key,a.byte_size,a.sha256,a.mime_type FROM job_artifacts a JOIN jobs j ON j.workspace_id=a.workspace_id AND j.id=a.job_id
    WHERE a.workspace_id=$1 AND a.job_id=$2 AND a.id=$3 AND a.status='READY' AND j.type='AI_VIDEO' AND j.status='SUCCEEDED' AND NOT EXISTS(SELECT 1 FROM job_billing b WHERE b.job_id=j.id AND b.status='RELEASED')`,[workspaceId,jobId,artifactId]);
  const artifact=rows.rows[0];if(!artifact)throw new AppError(404,"Video artifact not found.");
  if(!await objectStorage().head(artifact.storage_key))throw new AppError(503,"Video file is temporarily unavailable.");
  return {url:await objectStorage().issueDownload(artifact.storage_key,`${jobId}.mp4`,300),expiresInSeconds:300,mimeType:artifact.mime_type,byteSize:Number(artifact.byte_size),sha256:artifact.sha256};
}
