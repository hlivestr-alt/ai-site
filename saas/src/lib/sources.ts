import "server-only";
import { randomUUID } from "node:crypto";
import { query, transaction, withMediaFinalizeLock, type DbClient } from "./db";
import { AppError, isUuid } from "./core";
import { requireActiveWorkspace } from "./products";
import { requireRole } from "./workspaces";
import { objectStorage } from "./storage";
import { probeVideo, MEDIA_VALIDATION_VERSION } from "./media-probe";
import { maxClipperSourceBytes, SOURCE_PART_BYTES } from "./clipper-core";
import type { Session } from "./auth";
import {checkSourceQuota,checkStorageQuota} from './operational-limits';
export type SourceRow={id:string;workspace_id:string;status:string;original_filename:string;mime_type:string;byte_size:string;storage_key:string;upload_key:string;multipart_upload_id:string|null;part_size:number;sha256:string|null;duration_seconds:number|null;width:number|null;height:number|null;created_at:Date;media_validation_version?:number|null;media_validated_etag?:string|null};
export async function scopedSource(db:DbClient,workspaceId:string,id:string,lock=false){if(!isUuid(id))throw new AppError(404,"Source not found.");const r=await db.query<SourceRow>(`SELECT * FROM source_assets WHERE workspace_id=$1 AND id=$2 ${lock?"FOR UPDATE":""}`,[workspaceId,id]);if(!r.rows[0])throw new AppError(404,"Source not found.");return r.rows[0];}
function publicSource(row:SourceRow){return {id:row.id,status:row.status,filename:row.original_filename,mimeType:row.mime_type,byteSize:Number(row.byte_size),sha256:row.sha256,durationSeconds:row.duration_seconds,width:row.width,height:row.height,createdAt:row.created_at};}
export async function sourceList(session:Session,workspaceId:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");const r=await query<SourceRow>("SELECT * FROM source_assets WHERE workspace_id=$1 AND status<>'ARCHIVED' ORDER BY created_at DESC LIMIT 100",[workspaceId]);return r.rows.map(publicSource);}
export async function sourceCreate(session:Session,workspaceId:string,raw:Record<string,unknown>){
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  const {filename,mimeType,byteSize}=raw;
  if(raw.storageKey!==undefined)throw new AppError(400,"Object keys are not accepted.");
  if(typeof filename!=="string"||!filename.trim()||filename.length>255||mimeType!=="video/mp4")throw new AppError(400,"Select an MP4 source.");
  if(typeof byteSize!=="number"||!Number.isSafeInteger(byteSize)||byteSize<12||byteSize>maxClipperSourceBytes())throw new AppError(413,"Source exceeds the configured video limit.");
  const name=filename.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g,"").slice(0,200);if(!name)throw new AppError(400,"Invalid source filename.");
  const id=randomUUID(),uploadKey=`pending/workspaces/${workspaceId}/sources/${id}/upload`,key=`workspaces/${workspaceId}/sources/${id}/original`;
  await transaction(async db=>{await requireRole(session.userId,workspaceId,"future:edit",db);await checkSourceQuota(db,workspaceId,byteSize);await db.query("INSERT INTO source_assets(id,workspace_id,original_filename,mime_type,byte_size,storage_key,upload_key,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[id,workspaceId,name,mimeType,byteSize,key,uploadKey,session.userId]);});
  try{if(byteSize>SOURCE_PART_BYTES){const uploadId=await objectStorage().createMultipart(uploadKey,mimeType);await query("UPDATE source_assets SET multipart_upload_id=$1 WHERE id=$2 AND status='PENDING_UPLOAD'",[uploadId,id]);}return await sourceUpload(session,workspaceId,id);}
  catch{await query("UPDATE source_assets SET status='FAILED',failure_code='SIGN_FAILED',failed_at=now() WHERE id=$1 AND status='PENDING_UPLOAD'",[id]);throw new AppError(503,'Source upload is temporarily unavailable.');}
}
export async function sourceUpload(session:Session,workspaceId:string,id:string){
  await requireActiveWorkspace(session,workspaceId,"future:edit");const row=await scopedSource({query},workspaceId,id);
  if(row.status!=="PENDING_UPLOAD")throw new AppError(409,"Source upload is already closed.");
  return {source:publicSource(row),mode:row.multipart_upload_id?"multipart":"simple",partSize:row.part_size,partCount:Math.ceil(Number(row.byte_size)/row.part_size),parts:row.multipart_upload_id?await objectStorage().listParts(row.upload_key,row.multipart_upload_id):[],uploadUrl:row.multipart_upload_id?undefined:await objectStorage().issueUpload(row.upload_key,row.mime_type,900),requiredHeaders:{"Content-Type":row.mime_type},expiresInSeconds:900};
}
export async function sourcePart(session:Session,workspaceId:string,id:string,raw:Record<string,unknown>){
  await requireActiveWorkspace(session,workspaceId,"future:edit");const row=await scopedSource({query},workspaceId,id);const part=raw.partNumber;
  if(raw.storageKey!==undefined||typeof part!=="number"||!Number.isInteger(part)||part<1||part>Math.ceil(Number(row.byte_size)/row.part_size))throw new AppError(400,"Invalid upload part.");
  if(row.status!=="PENDING_UPLOAD"||!row.multipart_upload_id)throw new AppError(409,"Multipart upload is unavailable.");
  return {url:await objectStorage().issuePart(row.upload_key,row.multipart_upload_id,part,900),expiresInSeconds:900};
}
export async function sourceFinalize(session:Session,workspaceId:string,id:string){
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  return withMediaFinalizeLock(`source:${workspaceId}:${id}`, () => sourceFinalizeLocked(session,workspaceId,id));
}
async function sourceFinalizeLocked(session:Session,workspaceId:string,id:string){
  await requireActiveWorkspace(session,workspaceId,"future:edit");const existing=await scopedSource({query},workspaceId,id);if(['UPLOADED','VERIFIED'].includes(existing.status))return publicSource(existing);const row=await transaction(async db=>{
    await requireRole(session.userId,workspaceId,"future:edit",db);await checkStorageQuota(db,workspaceId);const row=await scopedSource(db,workspaceId,id,true);
    if(!['PENDING_UPLOAD','UPLOADED','VERIFIED'].includes(row.status))throw new AppError(409,"Source cannot be finalized.");return row;
  });if(row.status!=='PENDING_UPLOAD')return publicSource(row);
    // Pending byte allocations remain durable while multipart storage I/O runs outside SQL locks.
    const storage=objectStorage();let head=await storage.head(row.upload_key);
    if(!head&&row.multipart_upload_id){
      const parts=await storage.listParts(row.upload_key,row.multipart_upload_id),count=Math.ceil(Number(row.byte_size)/row.part_size);
      if(parts.length!==count||parts.some((p,i)=>p.partNumber!==i+1||p.byteSize!==Math.min(row.part_size,Number(row.byte_size)-i*row.part_size)))throw new AppError(409,"Upload has missing or incomplete parts.");
      await storage.completeMultipart(row.upload_key,row.multipart_upload_id,parts);head=await storage.head(row.upload_key);
    }
    if(!head||head.byteSize!==Number(row.byte_size)||head.contentType!==row.mime_type)throw new AppError(409,"Source upload size or type differs.");
    // Serialize finalizers and reuse an already sealed object after interruption.
    // Browser upload signatures only permit writes to the staging key.
    if(!await storage.head(row.storage_key))await storage.copyLarge(row.upload_key,row.storage_key,head,row.mime_type);
    const sealed=await storage.head(row.storage_key);if(!sealed||sealed.byteSize!==Number(row.byte_size))throw new AppError(503,"Source sealing is incomplete.");
    let media;
    try { media=await probeVideo(storage,row.storage_key,sealed,true); }
    catch(error){if(error instanceof AppError&&error.status===422)await query("UPDATE source_assets SET status='FAILED',failure_code='VALIDATION_FAILED',failed_at=now() WHERE workspace_id=$1 AND id=$2 AND status='PENDING_UPLOAD'",[workspaceId,id]);throw error;}
    const result=await transaction(async db=>{
      await requireRole(session.userId,workspaceId,'future:edit',db);await checkStorageQuota(db,workspaceId);const current=await scopedSource(db,workspaceId,id,true);
      if(['UPLOADED','VERIFIED'].includes(current.status))return publicSource(current);
      if(current.status!=='PENDING_UPLOAD')throw new AppError(409,'Source upload was closed.');
      const updated=await db.query<SourceRow>("UPDATE source_assets SET status='UPLOADED',finalized_at=now(),duration_seconds=$2,width=$3,height=$4,media_validation_version=$5,media_validated_at=now(),media_validated_etag=$6 WHERE id=$1 RETURNING *",[id,media.durationSeconds,media.width,media.height,MEDIA_VALIDATION_VERSION,sealed.etag]);return publicSource(updated.rows[0]);
    });await storage.delete(row.upload_key).catch(()=>{});return result;
}

export async function sourceAbort(session:Session,workspaceId:string,id:string){await requireActiveWorkspace(session,workspaceId,"future:edit");return transaction(async db=>{await requireRole(session.userId,workspaceId,"future:edit",db);const row=await scopedSource(db,workspaceId,id,true);if(row.status!=="PENDING_UPLOAD")throw new AppError(409,"Finalized sources cannot be aborted.");if(row.multipart_upload_id)await objectStorage().abortMultipart(row.upload_key,row.multipart_upload_id);await objectStorage().delete(row.upload_key);await db.query("UPDATE source_assets SET status='FAILED' WHERE id=$1",[id]);return {status:"FAILED"};});}
export async function sourceDownload(session:Session,workspaceId:string,id:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");const row=await scopedSource({query},workspaceId,id);if(!["UPLOADED","VERIFIED"].includes(row.status))throw new AppError(404,"Source unavailable.");return {url:await objectStorage().issueDownload(row.storage_key,row.original_filename,300),expiresInSeconds:300};}
