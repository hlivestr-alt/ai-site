import "server-only";
import { query, transaction, type DbClient } from "./db";
import { AppError, isUuid } from "./core";
import { requireActiveWorkspace, getProductSnapshot } from "./products";
import { requireRole } from "./workspaces";
import { frozenProductFromSnapshot } from "./jobs";
import { scopedJob, type ClipperInput, type ClipperWorkerInput } from "./job-core";
import { ensureSourceMediaValidation } from "./source-validation";
import { clipperRequest, clipperRequestHash } from "./clipper-core";
import {createQuote,lockWallet,jobBilling} from "./billing-core";
import { objectStorage } from "./storage";
import {prepareClipperInput} from "./clipper-operation";
import {admitOperation} from "./paid-operations";
import type { Session } from "./auth";
import {clipperCustomerMessages} from './worker-messages';
import {clipEditorContent} from './clipper-variations';
async function prepareClipper(db:DbClient,session:Session,workspaceId:string,request:ReturnType<typeof clipperRequest>){
    const source=await ensureSourceMediaValidation(db,workspaceId,request.sourceAssetId);
    let product:ClipperInput["product"];
    if(request.productId){const snapshot=await getProductSnapshot(session,workspaceId,request.productId,db);if(snapshot.product.status!=="ACTIVE")throw new AppError(409,"Select an active Product.");product={...frozenProductFromSnapshot(snapshot),assets:[]};}
    return prepareClipperInput(request,source,product);
}
export async function quoteClipper(session:Session,workspaceId:string,raw:Record<string,unknown>){const request=clipperRequest({...raw,idempotencyKey:raw.idempotencyKey||"quote-request"});await requireActiveWorkspace(session,workspaceId,"future:spend");return transaction(async db=>{await requireRole(session.userId,workspaceId,"future:spend",db);return createQuote(db,workspaceId,session.userId,"CLIPPER",await prepareClipper(db,session,workspaceId,request),clipperRequestHash(request));});}
export async function createClipperJob(session:Session,workspaceId:string,raw:Record<string,unknown>){
  const request=clipperRequest(raw),requestHash=clipperRequestHash(request);await requireActiveWorkspace(session,workspaceId,"future:spend");
  return transaction(async db=>{
    await requireRole(session.userId,workspaceId,"future:spend",db);
    await lockWallet(db,workspaceId);
    const prior=await db.query<{id:string;client_request_hash:string;billing_mode:string}>("SELECT id,client_request_hash,billing_mode FROM jobs WHERE workspace_id=$1 AND type='CLIPPER' AND idempotency_key=$2",[workspaceId,request.idempotencyKey]);
    if(prior.rows[0]){if(prior.rows[0].billing_mode==="DIAGNOSTIC"||prior.rows[0].client_request_hash!==requestHash)throw new AppError(409,"Idempotency key was already used for different input.");return {id:prior.rows[0].id,existing:true};}
    const input=await prepareClipper(db,session,workspaceId,request);
    return admitOperation(db,{workspaceId,userId:session.userId,input,requestHash,key:request.idempotencyKey,quote:raw});
  });
}
export async function clipperHistory(session:Session,workspaceId:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");const r=await query<{id:string;type:string;variation_number:number|null;status:string;created_at:Date;started_at:Date|null;finished_at:Date|null;input_snapshot:ClipperWorkerInput;result:{clips?:unknown[]}|null}>("SELECT j.id,j.type,j.status,j.created_at,j.started_at,j.finished_at,j.input_snapshot,j.result,v.variation_number FROM jobs j LEFT JOIN clipper_variations v ON v.workspace_id=j.workspace_id AND v.render_job_id=j.id WHERE j.workspace_id=$1 AND j.type IN('CLIPPER','CLIPPER_VARIATION') ORDER BY j.created_at DESC,j.id DESC LIMIT 50",[workspaceId]);return r.rows.map(({input_snapshot:i,result,...r})=>({...r,filename:i.kind==='CLIPPER_VARIATION'?`${i.settings.name?i.settings.name+' · ':''}Variation ${r.variation_number}`:i.source.filename,productName:i.product?.information.name||null,requested:i.targetClipCount,found:result?.clips?.length||0}));}
export async function clipperDetail(session:Session,workspaceId:string,id:string){
 await requireActiveWorkspace(session,workspaceId,"workspace:read");const row=await scopedJob({query},workspaceId,id);
 if(row.input_snapshot.kind!=="CLIPPER"&&row.input_snapshot.kind!=='CLIPPER_VARIATION')throw new AppError(404,"Clipper Job not found.");
 const i=row.input_snapshot,safe=clipperCustomerMessages(row),result=row.status==='SUCCEEDED'?row.result:null;
 const clips=result?.clips as import('./clipper-core').Clip[]|undefined;
 const contentIds=clips?await Promise.all(clips.map(c=>clipEditorContent(workspaceId,id,c.artifactId))):[];
 const variation=i.kind==='CLIPPER_VARIATION'?(await query<{variation_number:number}>("SELECT variation_number FROM clipper_variations WHERE workspace_id=$1 AND render_job_id=$2",[workspaceId,id])).rows[0]:null;
 return {job:{billing:await jobBilling(workspaceId,id),id:row.id,kind:i.kind,variationNumber:variation?.variation_number||null,status:row.status,progressPercent:row.progress_percent,stage:safe.stage,message:safe.message,cancelRequested:!!row.cancel_requested_at,source:i.source.filename,requested:i.targetClipCount,goal:i.goal,errorMessage:safe.errorMessage,productName:i.product?.information.name||null,startedAt:row.started_at||null,completedAt:row.finished_at||null,publicationPending:!!clips&&contentIds.some(c=>!c),result:result?{...result,clips:clips?.map((c,n)=>({...c,contentId:contentIds[n]}))}:null}};
}
export async function clipperArtifactDownload(session:Session,workspaceId:string,jobId:string,id:string,attachment=false){await requireActiveWorkspace(session,workspaceId,"workspace:read");if(!isUuid(jobId)||!isUuid(id))throw new AppError(404,"Artifact not found.");const r=await query<{storage_key:string;slot_name:string;mime_type:string}>("SELECT a.storage_key,a.slot_name,a.mime_type FROM job_artifacts a JOIN jobs j ON j.workspace_id=a.workspace_id AND j.id=a.job_id WHERE a.workspace_id=$1 AND a.job_id=$2 AND a.id=$3 AND a.status='READY' AND j.type IN('CLIPPER','CLIPPER_VARIATION') AND j.status='SUCCEEDED' AND NOT EXISTS(SELECT 1 FROM job_billing b WHERE b.job_id=j.id AND b.status='RELEASED') AND j.result->'artifactIds' ? a.id::text",[workspaceId,jobId,id]);const a=r.rows[0];if(!a)throw new AppError(404,"Artifact not found.");return {url:await objectStorage().issueDownload(a.storage_key,`${a.slot_name}.${a.mime_type==="video/mp4"?"mp4":"json"}`,300,attachment),expiresInSeconds:300};}
