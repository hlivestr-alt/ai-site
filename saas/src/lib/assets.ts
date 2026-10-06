import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { query, transaction, withMediaFinalizeLock, type DbClient } from "./db";
import { AppError, audit, isUuid } from "./core";
import { requireActiveWorkspace } from "./products";
import { requireRole } from "./workspaces";
import { objectStorage, originalObjectKey, thumbnailObjectKey, uploadObjectKey } from "./storage";
import { signatureMatches, uploadInput } from "./media-validation";
import { probeVideo } from "./media-probe";
import type { Session } from "./auth";
import {checkAssetQuota,checkStorageQuota} from './operational-limits';

type AssetRow={id:string;workspace_id:string;product_id:string;type:"IMAGE"|"VIDEO";purpose:string;status:string;current_version_id:string|null};
type AssetVersionRow={id:string;workspace_id:string;product_id:string;asset_id:string;version_number:number;status:string;storage_key:string;upload_key:string;original_filename:string;mime_type:string;expected_byte_size:string;expected_sha256:string|null;byte_size:string|null;sha256:string|null;thumbnail_key:string|null};

async function scopedAsset(db:DbClient,workspaceId:string,productId:string,assetId:string,lock=false):Promise<AssetRow> {
  if(!isUuid(assetId)||!isUuid(productId))throw new AppError(404,"Asset not found.");
  const result=await db.query<AssetRow>(`SELECT a.* FROM assets a JOIN products p ON p.workspace_id=a.workspace_id AND p.id=a.product_id
    WHERE a.workspace_id=$1 AND a.product_id=$2 AND a.id=$3 ${lock?"FOR UPDATE OF a":""}`,[workspaceId,productId,assetId]);
  if(!result.rows[0])throw new AppError(404,"Asset not found.");
  return result.rows[0];
}

async function scopedVersion(db:DbClient,workspaceId:string,productId:string,assetId:string,versionId:string):Promise<AssetVersionRow> {
  if(!isUuid(versionId))throw new AppError(404,"Asset version not found.");
  const result=await db.query<AssetVersionRow>("SELECT * FROM asset_versions WHERE workspace_id=$1 AND product_id=$2 AND asset_id=$3 AND id=$4",[workspaceId,productId,assetId,versionId]);
  if(!result.rows[0])throw new AppError(404,"Asset version not found.");
  return result.rows[0];
}

export async function createUploadIntent(session:Session,workspaceId:string,productId:string,raw:Record<string,unknown>,replaceAssetId?:string) {
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  const input=uploadInput(raw);
  const assetId=replaceAssetId||randomUUID(),versionId=randomUUID();
  const uploadKey=uploadObjectKey(workspaceId,productId,assetId,versionId);
  const storageKey=originalObjectKey(workspaceId,productId,assetId,versionId);
  const result=await transaction(async db=>{
    await requireRole(session.userId,workspaceId,"future:edit",db);
    await checkAssetQuota(db,workspaceId,input.byteSize,input.mimeType.startsWith('image/'),!!replaceAssetId);
    const product=await db.query<{status:string}>("SELECT status FROM products WHERE workspace_id=$1 AND id=$2 FOR UPDATE",[workspaceId,productId]);
    if(!product.rows[0])throw new AppError(404,"Product not found.");
    if(product.rows[0].status==="ARCHIVED")throw new AppError(409,"Archived products cannot receive media.");
    let versionNumber=1;
    if(replaceAssetId) {
      const asset=await scopedAsset(db,workspaceId,productId,replaceAssetId,true);
      if(asset.status==="ARCHIVED")throw new AppError(409,"Archived assets cannot be replaced.");
      if(asset.purpose!==input.purpose||asset.type!==input.type)throw new AppError(400,"Replacement must keep its purpose and media type.");
      const pending=await db.query("SELECT 1 FROM asset_versions WHERE workspace_id=$1 AND product_id=$2 AND asset_id=$3 AND status='PENDING_UPLOAD'",[workspaceId,productId,assetId]);
      if(pending.rows[0])throw new AppError(409,"This asset already has a pending upload.");
      const latest=await db.query<{version_number:number}>("SELECT version_number FROM asset_versions WHERE workspace_id=$1 AND product_id=$2 AND asset_id=$3 ORDER BY version_number DESC LIMIT 1",[workspaceId,productId,assetId]);
      versionNumber=latest.rows[0].version_number+1;
    } else {
      const capacity=await db.query<{count:string}>("SELECT count(*) FROM assets WHERE workspace_id=$1 AND product_id=$2 AND status<>'ARCHIVED'",[workspaceId,productId]);
      if(Number(capacity.rows[0].count)>=100)throw new AppError(409,"A product can have at most 100 current assets.");
      await db.query("INSERT INTO assets(id,workspace_id,product_id,type,purpose,status,created_by) VALUES($1,$2,$3,$4,$5,'PENDING_UPLOAD',$6)",[assetId,workspaceId,productId,input.type,input.purpose,session.userId]);
    }
    await db.query(`INSERT INTO asset_versions(id,workspace_id,product_id,asset_id,version_number,status,storage_key,upload_key,original_filename,mime_type,expected_byte_size,expected_sha256,source_type,permission_note,permission_confirmed_at,uploaded_by)
      VALUES($1,$2,$3,$4,$5,'PENDING_UPLOAD',$6,$7,$8,$9,$10,$11,$12,$13,now(),$14)`,[versionId,workspaceId,productId,assetId,versionNumber,storageKey,uploadKey,input.originalFilename,input.mimeType,input.byteSize,input.expectedSha256||null,input.sourceType,input.permissionNote,session.userId]);
    return {assetId,versionId,versionNumber};
  });
  try {
    const uploadUrl=await objectStorage().issueUpload(uploadKey,input.mimeType,300);
    return {...result,uploadUrl,requiredHeaders:{"Content-Type":input.mimeType},expiresInSeconds:300};
  } catch(error) {
    await markFailed(workspaceId,productId,assetId,versionId,"SIGN_FAILED").catch(()=>undefined);
    throw error;
  }
}

async function markFailed(workspaceId:string,productId:string,assetId:string,versionId:string,code:string) {
  await transaction(async db=>{
    await db.query("UPDATE asset_versions SET status='FAILED',failure_code=$1,failed_at=now() WHERE workspace_id=$2 AND product_id=$3 AND asset_id=$4 AND id=$5 AND status='PENDING_UPLOAD'",[code,workspaceId,productId,assetId,versionId]);
    await db.query("UPDATE assets SET status='FAILED',updated_at=now() WHERE workspace_id=$1 AND product_id=$2 AND id=$3 AND current_version_id IS NULL AND status='PENDING_UPLOAD'",[workspaceId,productId,assetId]);
  });
}

async function verifyObject(key:string,mimeType:string,maxBytes:number,expectedBytes:number,expectedSha:string|null) {
  const storage=objectStorage();
  const head=await storage.head(key);
  if(!head)throw new AppError(409,"Upload has not arrived in storage.");
  if(head.byteSize!==expectedBytes||head.byteSize===0||head.byteSize>maxBytes)throw new AppError(422,"Uploaded size does not match the intent.");
  if(head.contentType&&head.contentType!==mimeType)throw new AppError(422,"Uploaded media type does not match the intent.");
  const video = mimeType === "video/mp4" ? await probeVideo(storage, key, head) : null;
  const hash=createHash("sha256");const chunks:Buffer[]=[];let total=0;let first=Buffer.alloc(0);
  for await (const chunk of await storage.stream(key)) {
    const bytes=Buffer.from(chunk);total+=bytes.length;
    if(total>maxBytes)throw new AppError(422,"Uploaded file is too large.");
    hash.update(bytes);
    if(first.length<64)first=Buffer.concat([first,bytes]).subarray(0,64);
    if(mimeType.startsWith("image/"))chunks.push(bytes);
  }
  if(total!==head.byteSize)throw new AppError(422,"Uploaded file changed during verification.");
  if(!signatureMatches(mimeType,first))throw new AppError(422,"File signature does not match its media type.");
  const sha256=hash.digest("hex");
  if(expectedSha&&expectedSha!==sha256)throw new AppError(422,"Uploaded checksum does not match the intent.");
  let width:number|null=video?.width||null,height:number|null=video?.height||null,thumbnail:Buffer|null=null;
  if(mimeType.startsWith("image/")) {
    const image=Buffer.concat(chunks);
    try {
      const meta=await sharp(image,{limitInputPixels:100_000_000}).metadata();
      width=meta.width||null;height=meta.height||null;
      if(!width||!height||width>20000||height>20000)throw new Error("invalid dimensions");
      try {thumbnail=await sharp(image,{limitInputPixels:100_000_000}).rotate().resize(480,480,{fit:"inside",withoutEnlargement:true}).jpeg({quality:78}).toBuffer();}
      catch {thumbnail=null;}
    } catch {throw new AppError(422,"Image could not be decoded safely.");}
  }
  return {head,sha256,total,width,height,thumbnail};
}

export async function finalizeUpload(session:Session,workspaceId:string,productId:string,assetId:string,versionId:string) {
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  return withMediaFinalizeLock(`asset:${workspaceId}:${versionId}`, () => finalizeUploadLocked(session,workspaceId,productId,assetId,versionId));
}
async function finalizeUploadLocked(session:Session,workspaceId:string,productId:string,assetId:string,versionId:string) {
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  await scopedAsset({query},workspaceId,productId,assetId);
  const version=await scopedVersion({query},workspaceId,productId,assetId,versionId);
  if(version.status==="READY")return {assetId,versionId,status:"READY",alreadyFinalized:true};
  if(version.status!=="PENDING_UPLOAD")throw new AppError(409,"Upload is not pending.");
  await transaction(async db=>{await checkStorageQuota(db,workspaceId);});
  const max=version.mime_type.startsWith("image/")?Number(process.env.MAX_IMAGE_BYTES||20*1024*1024):Number(process.env.MAX_VIDEO_BYTES||500*1024*1024);
  const storage=objectStorage();
  const staged=await storage.head(version.upload_key);
  const sourceKey=staged?version.upload_key:version.storage_key;
  const finalExists=!staged&&!!(await storage.head(version.storage_key));
  if(!staged&&!finalExists)throw new AppError(409,"Upload has not arrived in storage.");
  let verified;
  try {verified=await verifyObject(sourceKey,version.mime_type,max,Number(version.expected_byte_size),version.expected_sha256);}
  catch(error) {
    if(error instanceof AppError&&error.status===422)await markFailed(workspaceId,productId,assetId,versionId,"VALIDATION_FAILED");
    throw error;
  }
  if(!finalExists)await storage.copy(version.upload_key,version.storage_key,verified.head.etag,version.mime_type);
  const finalHead=await storage.head(version.storage_key);
  if(!finalHead||finalHead.byteSize!==verified.total)throw new AppError(503,"Storage copy did not complete. Retry finalization.");
  let thumbnailKey:string|null=null;
  if(verified.thumbnail) {
    thumbnailKey=thumbnailObjectKey(workspaceId,productId,assetId,versionId);
    try {await storage.put(thumbnailKey,verified.thumbnail,"image/jpeg");}
    catch {thumbnailKey=null;}
  }
  const result=await transaction(async db=>{
    await requireRole(session.userId,workspaceId,"future:edit",db);
    await checkStorageQuota(db,workspaceId);
    const asset=await scopedAsset(db,workspaceId,productId,assetId,true);
    const current=await scopedVersion(db,workspaceId,productId,assetId,versionId);
    if(current.status==="READY")return {assetId,versionId,status:"READY" as const,alreadyFinalized:true};
    if(current.status!=="PENDING_UPLOAD"||asset.status==="ARCHIVED")throw new AppError(409,"Upload can no longer be finalized.");
    if(thumbnailKey&&verified.thumbnail)await db.query('INSERT INTO storage_object_observations(workspace_id,storage_key,byte_size) VALUES($1,$2,$3) ON CONFLICT(workspace_id,storage_key) DO UPDATE SET byte_size=$3,last_checked_at=now()',[workspaceId,thumbnailKey,verified.thumbnail.length]);
    await db.query(`UPDATE asset_versions SET status='READY',byte_size=$1,sha256=$2,width=$3,height=$4,thumbnail_key=$5,verified_at=now(),failure_code=$6
      WHERE workspace_id=$7 AND product_id=$8 AND asset_id=$9 AND id=$10`,[verified.total,verified.sha256,verified.width,verified.height,thumbnailKey,verified.thumbnail?thumbnailKey?null:"THUMBNAIL_FAILED":null,workspaceId,productId,assetId,versionId]);
    await db.query("UPDATE assets SET current_version_id=$1,status='READY',updated_at=now() WHERE workspace_id=$2 AND product_id=$3 AND id=$4",[versionId,workspaceId,productId,assetId]);
    await audit(db,{workspaceId,actorUserId:session.userId,type:"PRODUCT_ASSET_CREATED",targetType:"asset",targetId:assetId,metadata:{version:current.version_number,purpose:asset.purpose}});
    return {assetId,versionId,status:"READY" as const,alreadyFinalized:false,sha256:verified.sha256,byteSize:verified.total,width:verified.width,height:verified.height,thumbnailAvailable:!!thumbnailKey};
  });
  if(staged)await storage.delete(version.upload_key).catch(()=>undefined);
  return result;
}

export async function getAssetMetadata(session:Session,workspaceId:string,productId:string,assetId:string) {
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  const asset=await scopedAsset({query},workspaceId,productId,assetId);
  const version=asset.current_version_id?await scopedVersion({query},workspaceId,productId,assetId,asset.current_version_id):null;
  return {asset,version:version?{id:version.id,versionNumber:version.version_number,status:version.status,filename:version.original_filename,mimeType:version.mime_type,byteSize:version.byte_size,sha256:version.sha256,thumbnailAvailable:!!version.thumbnail_key}:null};
}

export async function listProductAssets(session:Session,workspaceId:string,productId:string,page=1) {
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  if(!isUuid(productId))throw new AppError(404,"Product not found.");
  const parent=await query("SELECT 1 FROM products WHERE workspace_id=$1 AND id=$2",[workspaceId,productId]);
  if(!parent.rows[0])throw new AppError(404,"Product not found.");
  const boundedPage=Math.max(1,Math.min(500,Math.trunc(page||1)));
  const result=await query<{id:string;purpose:string;type:string;status:string;original_filename:string|null;version_number:number|null;byte_size:string|null}>(`SELECT a.id,a.purpose,a.type,a.status,v.original_filename,v.version_number,v.byte_size
    FROM assets a LEFT JOIN asset_versions v ON v.id=a.current_version_id AND v.workspace_id=a.workspace_id AND v.product_id=a.product_id AND v.asset_id=a.id
    WHERE a.workspace_id=$1 AND a.product_id=$2 AND a.status<>'ARCHIVED' ORDER BY a.created_at DESC,a.id DESC LIMIT 50 OFFSET $3`,[workspaceId,productId,(boundedPage-1)*50]);
  const count=await query<{count:string}>("SELECT count(*) FROM assets WHERE workspace_id=$1 AND product_id=$2 AND status<>'ARCHIVED'",[workspaceId,productId]);
  return {assets:result.rows,total:Number(count.rows[0].count),page:boundedPage,pageSize:50};
}

export async function getAssetVersions(session:Session,workspaceId:string,productId:string,assetId:string) {
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  await scopedAsset({query},workspaceId,productId,assetId);
  const result=await query<{id:string;version_number:number;status:string;original_filename:string;mime_type:string;byte_size:string|null;sha256:string|null;created_at:Date;verified_at:Date|null}>(`SELECT id,version_number,status,original_filename,mime_type,byte_size,sha256,created_at,verified_at
    FROM asset_versions WHERE workspace_id=$1 AND product_id=$2 AND asset_id=$3 ORDER BY version_number DESC LIMIT 50`,[workspaceId,productId,assetId]);
  return result.rows;
}

export async function getAuthorizedDownload(session:Session,workspaceId:string,productId:string,assetId:string,variant:"original"|"thumbnail"="original",expiresSeconds=60) {
  await requireActiveWorkspace(session,workspaceId,"workspace:read");
  const asset=await scopedAsset({query},workspaceId,productId,assetId);
  if(asset.status!=="READY"||!asset.current_version_id)throw new AppError(404,"Media is not available.");
  const version=await scopedVersion({query},workspaceId,productId,assetId,asset.current_version_id);
  if(version.status!=="READY")throw new AppError(404,"Media is not available.");
  const key=variant==="thumbnail"?version.thumbnail_key:version.storage_key;
  if(!key)throw new AppError(404,"Preview is not available.");
  const head=await objectStorage().head(key);
  if(!head) {
    await query("UPDATE assets SET status='FAILED',updated_at=now() WHERE workspace_id=$1 AND product_id=$2 AND id=$3 AND status='READY'",[workspaceId,productId,assetId]);
    throw new AppError(503,"Media is temporarily unavailable.");
  }
  const ttl=asset.type==="VIDEO"&&expiresSeconds===60?300:expiresSeconds;
  const url=await objectStorage().issueDownload(key,variant==="thumbnail"?"thumbnail.jpg":version.original_filename,ttl);
  return {url,expiresInSeconds:ttl,mimeType:variant==="thumbnail"?"image/jpeg":version.mime_type};
}

export async function archiveAsset(session:Session,workspaceId:string,productId:string,assetId:string) {
  await requireActiveWorkspace(session,workspaceId,"future:edit");
  return transaction(async db=>{
    await requireRole(session.userId,workspaceId,"future:edit",db);
    const asset=await scopedAsset(db,workspaceId,productId,assetId,true);
    if(asset.status==="ARCHIVED")return {id:assetId,status:"ARCHIVED" as const};
    await db.query("UPDATE assets SET status='ARCHIVED',archived_at=now(),updated_at=now() WHERE workspace_id=$1 AND product_id=$2 AND id=$3",[workspaceId,productId,assetId]);
    await audit(db,{workspaceId,actorUserId:session.userId,type:"PRODUCT_ASSET_ARCHIVED",targetType:"asset",targetId:assetId});
    return {id:assetId,status:"ARCHIVED" as const};
  });
}
