import "server-only";
import { timingSafeEqual } from "node:crypto";
import { transaction } from "./db";
import { AppError, audit, isUuid } from "./core";
import { requireRole } from "./workspaces";
import { getProductSnapshot, requireActiveWorkspace } from "./products";
import { cancelWorkspaceJob, insertJob, listWorkspaceJobs, workspaceJobCounts, workspaceJobDetail, type FrozenProduct, type JobInput } from "./job-core";
import type { Session } from "./auth";

export function frozenProductFromSnapshot(snapshot:Awaited<ReturnType<typeof getProductSnapshot>>):FrozenProduct{
  return {
    id:snapshot.product.id,versionId:snapshot.version.id,versionNumber:snapshot.version.version_number,
    ruleVersionId:snapshot.rules.id,ruleVersionNumber:snapshot.rules.version_number,
    information:{brand:snapshot.version.brand,name:snapshot.version.name,category:snapshot.version.category,sku:snapshot.version.sku,description:snapshot.version.description,keySellingPoints:snapshot.version.key_selling_points,targetAudience:snapshot.version.target_audience},
    rules:{keepLogo:snapshot.rules.keep_logo,keepPackagingText:snapshot.rules.keep_packaging_text,keepProductShape:snapshot.rules.keep_product_shape,keepCapPump:snapshot.rules.keep_cap_pump,keepProductColorMaterial:snapshot.rules.keep_product_color_material,keepApplicationMethod:snapshot.rules.keep_application_method,customInstructions:snapshot.rules.custom_instructions},
    assets:snapshot.assets.map(asset=>({assetId:asset.id,assetVersionId:asset.version_id,purpose:asset.purpose,type:asset.type,storageKey:asset.storage_key,sha256:asset.sha256,byteSize:Number(asset.byte_size),mimeType:asset.mime_type,width:asset.width,height:asset.height})),
  };
}

export function requireDiagnosticToken(raw:string|null){
  const expected=process.env.DEV_DIAGNOSTIC_TOKEN;
  if(process.env.APP_ENV!=="local"||!expected||expected.length<32||!raw)throw new AppError(404,"Not found.");
  const a=Buffer.from(raw),b=Buffer.from(expected);
  if(a.length!==b.length||!timingSafeEqual(a,b))throw new AppError(404,"Not found.");
}
function fixtureInput(raw:Record<string,unknown>){
  const steps=raw.steps,delayMs=raw.delayMs;
  if(typeof steps!=="number"||!Number.isInteger(steps)||steps<1||steps>20)throw new AppError(400,"Fixture steps must be 1–20.");
  if(typeof delayMs!=="number"||!Number.isInteger(delayMs)||delayMs<20||delayMs>5000)throw new AppError(400,"Fixture delay must be 20–5000 ms.");
  const key=raw.idempotencyKey;
  if(typeof key!=="string"||! /^[A-Za-z0-9:_-]{8,160}$/.test(key))throw new AppError(400,"Invalid idempotency key.");
  const productId=raw.productId;
  if(productId!=null&&(typeof productId!=="string"||!isUuid(productId)))throw new AppError(400,"Invalid Product ID.");
  const capability=raw.capability||"SYSTEM_TEST";
  if(typeof capability!=="string"||!/^SYSTEM_TEST(?:_[A-Z0-9]{4,40})?$/.test(capability))throw new AppError(400,"Invalid diagnostic capability.");
  return {steps,delayMs,key,productId:productId as string|undefined,capability};
}
export async function createDiagnosticJob(session:Session,workspaceId:string,raw:Record<string,unknown>){
  const input=fixtureInput(raw);
  const member=await requireActiveWorkspace(session,workspaceId,"future:edit");
  if(member.role!=="OWNER"&&member.role!=="ADMIN")throw new AppError(403,"Diagnostic Jobs require workspace admin access.");
  return transaction(async db=>{
    await requireRole(session.userId,workspaceId,"team:manage",db);
    let product:FrozenProduct|undefined;
    if(input.productId){
      const snapshot=await getProductSnapshot(session,workspaceId,input.productId,db);
      if(snapshot.product.status!=="ACTIVE")throw new AppError(409,"Diagnostic Product must be active.");
      product=frozenProductFromSnapshot(snapshot);
    }
    const frozen:JobInput={schemaVersion:1,kind:"SYSTEM_TEST",fixture:{steps:input.steps,delayMs:input.delayMs},...(product?{product}:{})};
    const result=await insertJob(db,{workspaceId,createdBy:session.userId,type:"SYSTEM_TEST",capability:input.capability,idempotencyKey:input.key,input:frozen,maxAttempts:3});
    if(!result.existing)await audit(db,{workspaceId,actorUserId:session.userId,type:"JOB_CREATED",targetType:"job",targetId:result.id});
    return result;
  });
}
export async function customerJobList(session:Session,workspaceId:string,options:{status?:string;page?:number}){
  await requireActiveWorkspace(session,workspaceId,"workspace:read");return listWorkspaceJobs(workspaceId,options);
}
export async function customerJobDetail(session:Session,workspaceId:string,jobId:string){
  await requireActiveWorkspace(session,workspaceId,"workspace:read");return workspaceJobDetail(workspaceId,jobId);
}
export async function customerJobCounts(session:Session,workspaceId:string){
  await requireActiveWorkspace(session,workspaceId,"workspace:read");return workspaceJobCounts(workspaceId);
}
export async function customerCancelJob(session:Session,workspaceId:string,jobId:string){
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  return transaction(async db=>{
    await requireRole(session.userId,workspaceId,"future:edit",db);
    return cancelWorkspaceJob(db,workspaceId,jobId);
  });
}
