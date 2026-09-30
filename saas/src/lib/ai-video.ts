import "server-only";
import { createHash } from "node:crypto";
import { query, transaction } from "./db";
import { AppError, audit, isUuid } from "./core";
import { requireRole } from "./workspaces";
import { getProductSnapshot, requireActiveWorkspace } from "./products";
import { frozenProductFromSnapshot } from "./jobs";
import { insertJob, type AiVideoInput, type FrozenAsset, type FrozenProduct } from "./job-core";
import { activeVideoPolicy, customerVideoOptions, fakeEnabled, providerForNewJob } from "./video-providers";
import { objectStorage } from "./storage";
import type { Session } from "./auth";

const rank=["FRONT","BACK","LEFT_SIDE","RIGHT_SIDE","PACKAGING","CAP_PUMP","TEXTURE"];
const scenarios=["SUCCESS","FAILURE","RATE_LIMIT","SUBMISSION_UNKNOWN","DOWNLOAD_FAIL_ONCE","OVERSIZED_OUTPUT","INVALID_MIME","INVALID_CHECKSUM"] as const;
type Scenario=(typeof scenarios)[number];
function parseRequest(raw:Record<string,unknown>,scenario?:Scenario){
  const productId=raw.productId,prompt=raw.prompt,tier=raw.tier,duration=raw.durationSeconds,ratio=raw.aspectRatio,quantity=raw.quantity,key=raw.idempotencyKey,selected=raw.referenceAssetVersionIds;
  if(typeof productId!=="string"||!isUuid(productId))throw new AppError(400,"Select a valid Product.");
  if(typeof prompt!=="string"||prompt.trim().length<20||prompt.length>2000||/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(prompt))throw new AppError(400,"Prompt must be 20–2000 readable characters.");
  if(tier!=="QUALITY")throw new AppError(400,"This quality tier is unavailable.");
  if(typeof duration!=="number"||!Number.isInteger(duration)||duration<4||duration>30)throw new AppError(400,"Choose a supported duration.");
  if(ratio!=="9:16"&&ratio!=="16:9"&&ratio!=="1:1")throw new AppError(400,"Choose a supported aspect ratio.");
  if(quantity!==1)throw new AppError(400,"One video per request is supported in this preview.");
  if(typeof key!=="string"||!/^[A-Za-z0-9:_-]{8,160}$/.test(key))throw new AppError(400,"Invalid idempotency key.");
  if(selected!==undefined&&(!Array.isArray(selected)||selected.length>4||selected.some(x=>typeof x!=="string"||!isUuid(x))||new Set(selected).size!==selected.length))throw new AppError(400,"Invalid reference selection.");
  const ids=(selected||[]) as string[];
  return {productId,prompt:prompt.trim(),tier,durationSeconds:duration,aspectRatio:ratio as "9:16"|"16:9"|"1:1",quantity:1 as const,idempotencyKey:key,referenceAssetVersionIds:ids,scenario};
}
function accuracyInstructions(product:FrozenProduct){
  const r=product.rules,phrases=[
    r.keepLogo&&"Keep the product logo visually faithful.",r.keepPackagingText&&"Keep packaging text and claims faithful; do not invent wording.",
    r.keepProductShape&&"Preserve the product silhouette and proportions.",r.keepCapPump&&"Preserve the cap or pump structure.",
    r.keepProductColorMaterial&&"Preserve the product color and material.",r.keepApplicationMethod&&"Show only the documented application method.",
  ].filter(Boolean) as string[];
  const custom=typeof r.customInstructions==="string"?r.customInstructions.trim().slice(0,700):"";
  if(custom)phrases.push(custom);
  return phrases.join(" ").slice(0,1400)||"Represent the saved Product reference faithfully.";
}
function validImage(asset:FrozenAsset){
  const width=asset.width||0,height=asset.height||0;
  return asset.type==="IMAGE"&&["image/png","image/jpeg","image/webp"].includes(asset.mimeType)&&asset.byteSize>0&&asset.byteSize<=4*1024*1024&&width>=300&&height>=300&&width<=6000&&height<=6000&&width*height>=407696&&width*height<=8295044&&width/height>=0.4&&width/height<=2.5;
}
function selectReferences(product:FrozenProduct,requested:string[],max:number){
  const candidates=product.assets.filter(validImage).sort((a,b)=>rank.indexOf(a.purpose)-rank.indexOf(b.purpose)||a.assetId.localeCompare(b.assetId));
  if(requested.length){const chosen=requested.map(id=>candidates.find(a=>a.assetVersionId===id));if(chosen.some(x=>!x))throw new AppError(409,"A selected Product reference is unavailable or unsupported.");return requested;}
  const chosen=candidates.slice(0,max).map(x=>x.assetVersionId);
  if(!chosen.length)throw new AppError(409,"Add a compatible READY Product image before generating (for example, 640 × 640 px).");
  return chosen;
}
export async function createAiVideoJob(session:Session,workspaceId:string,raw:Record<string,unknown>,scenario?:Scenario){
  if(scenario&&!fakeEnabled())throw new AppError(404,"Not found.");
  const input=parseRequest(raw,scenario),requestHash=createHash("sha256").update(JSON.stringify({productId:input.productId,prompt:input.prompt,tier:input.tier,durationSeconds:input.durationSeconds,aspectRatio:input.aspectRatio,quantity:input.quantity,referenceAssetVersionIds:input.referenceAssetVersionIds,scenario:input.scenario||null})).digest("hex");
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  return transaction(async db=>{
    await requireRole(session.userId,workspaceId,"future:edit",db);
    const prior=await db.query<{id:string;client_request_hash:string|null}>("SELECT id,client_request_hash FROM jobs WHERE workspace_id=$1 AND type='AI_VIDEO' AND idempotency_key=$2",[workspaceId,input.idempotencyKey]);
    if(prior.rows[0]){
      if(prior.rows[0].client_request_hash!==requestHash)throw new AppError(409,"Idempotency key was already used for different input.");
      return {id:prior.rows[0].id,existing:true};
    }
    const policy=await activeVideoPolicy();
    if(!policy||!policy.enabled)throw new AppError(503,"Video generation is not available.");
    const provider=providerForNewJob();
    if(input.durationSeconds<policy.min_duration_seconds||input.durationSeconds>policy.max_duration_seconds||!policy.aspect_ratios.includes(input.aspectRatio)||input.quantity>policy.max_quantity)throw new AppError(400,"The selected video settings are not supported.");
    const snapshot=await getProductSnapshot(session,workspaceId,input.productId,db);
    if(snapshot.product.status!=="ACTIVE")throw new AppError(409,"Select an active Product.");
    const product=frozenProductFromSnapshot(snapshot),references=selectReferences(product,input.referenceAssetVersionIds,policy.max_reference_images);
    const frozen:AiVideoInput={schemaVersion:1,kind:"AI_VIDEO",product,customerPrompt:input.prompt,accuracyInstructions:accuracyInstructions(product),tier:"QUALITY",durationSeconds:input.durationSeconds,aspectRatio:input.aspectRatio,quantity:1,referenceAssetVersionIds:references,providerPolicyVersion:policy.policy_version,executionProvider:provider.name,...(scenario?{testScenario:scenario}:{})};
    provider.validateInput(frozen);
    const result=await insertJob(db,{workspaceId,createdBy:session.userId,type:"AI_VIDEO",capability:"CLOUD_AI_VIDEO",idempotencyKey:input.idempotencyKey,input:frozen,maxAttempts:2,requestHash});
    if(!result.existing)await audit(db,{workspaceId,actorUserId:session.userId,type:"AI_VIDEO_JOB_CREATED",targetType:"job",targetId:result.id});
    return result;
  });
}
export async function aiVideoOptions(session:Session,workspaceId:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");return customerVideoOptions();}
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
  return {job:{id:row.id,status:row.status,progressPercent:row.progress_percent,progressStage:row.progress_stage,progressMessage:row.progress_message,errorMessage:row.error_message_safe,createdAt:row.created_at,startedAt:row.started_at,finishedAt:row.finished_at,cancelRequested:!!row.cancel_requested_at,prompt:input.customerPrompt,productId:input.product.id,productName:String(input.product.information.name||"Product"),productVersionId:input.product.versionId,productVersion:input.product.versionNumber,ruleVersion:input.product.ruleVersionNumber,tier:input.tier,durationSeconds:input.durationSeconds,aspectRatio:input.aspectRatio,referenceAssetVersionIds:input.referenceAssetVersionIds,artifacts:artifacts.rows.map(x=>({id:x.id,mimeType:x.mime_type,byteSize:Number(x.byte_size),sha256:x.sha256,createdAt:x.created_at}))}};
}
export async function aiVideoArtifactDownload(session:Session,workspaceId:string,jobId:string,artifactId:string){
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  if(!isUuid(jobId)||!isUuid(artifactId))throw new AppError(404,"Video artifact not found.");
  const rows=await query<{storage_key:string;byte_size:string;sha256:string;mime_type:string}>(`SELECT a.storage_key,a.byte_size,a.sha256,a.mime_type FROM job_artifacts a JOIN jobs j ON j.workspace_id=a.workspace_id AND j.id=a.job_id
    WHERE a.workspace_id=$1 AND a.job_id=$2 AND a.id=$3 AND a.status='READY' AND j.type='AI_VIDEO' AND j.status='SUCCEEDED'`,[workspaceId,jobId,artifactId]);
  const artifact=rows.rows[0];if(!artifact)throw new AppError(404,"Video artifact not found.");
  if(!await objectStorage().head(artifact.storage_key))throw new AppError(503,"Video file is temporarily unavailable.");
  return {url:await objectStorage().issueDownload(artifact.storage_key,`${jobId}.mp4`,300),expiresInSeconds:300,mimeType:artifact.mime_type,byteSize:Number(artifact.byte_size),sha256:artifact.sha256};
}
export function diagnosticVideoScenario(raw:unknown):Scenario{
  if(typeof raw!=="string"||!scenarios.includes(raw as Scenario))throw new AppError(400,"Invalid diagnostic scenario.");
  return raw as Scenario;
}
