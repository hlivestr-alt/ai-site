import { AppError } from "./core";

export const purposes=["FRONT","BACK","LEFT_SIDE","RIGHT_SIDE","PACKAGING","CAP_PUMP","TEXTURE","USAGE_IMAGE","USAGE_VIDEO","PRODUCT_VIDEO","OTHER"] as const;
export type AssetPurpose=typeof purposes[number];
export type AssetType="IMAGE"|"VIDEO";
export const sourceTypes=["CUSTOMER_UPLOAD","CUSTOMER_OWNED","LICENSED","CREATOR_AUTHORIZED","OTHER"] as const;
export type SourceType=typeof sourceTypes[number];
const imageMimes=new Set(["image/jpeg","image/png","image/webp"]);

export function uploadInput(raw:Record<string,unknown>) {
  const purpose=raw.purpose;
  if(typeof purpose!=="string"||!purposes.includes(purpose as AssetPurpose))throw new AppError(400,"Invalid asset purpose.");
  const mimeType=raw.mimeType;
  if(typeof mimeType!=="string"||(!imageMimes.has(mimeType)&&mimeType!=="video/mp4"))throw new AppError(415,"Unsupported media type.");
  const type:AssetType=imageMimes.has(mimeType)?"IMAGE":"VIDEO";
  if(type==="VIDEO"&&!(["USAGE_VIDEO","PRODUCT_VIDEO","OTHER"] as string[]).includes(purpose))throw new AppError(400,"This purpose requires an image.");
  if(type==="IMAGE"&&(["USAGE_VIDEO","PRODUCT_VIDEO"] as string[]).includes(purpose))throw new AppError(400,"This purpose requires a video.");
  const max=type==="IMAGE"?Number(process.env.MAX_IMAGE_BYTES||20*1024*1024):Number(process.env.MAX_VIDEO_BYTES||500*1024*1024);
  const byteSize=raw.byteSize;
  if(typeof byteSize!=="number"||!Number.isSafeInteger(byteSize)||byteSize<=0||byteSize>max)throw new AppError(413,`File must be between 1 and ${Math.floor(max/1024/1024)} MiB.`);
  const filename=raw.filename;
  if(typeof filename!=="string"||!filename.trim()||filename.length>255)throw new AppError(400,"Invalid filename.");
  const originalFilename=filename.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g,"").slice(0,200);
  if(!originalFilename)throw new AppError(400,"Invalid filename.");
  const sourceType=raw.sourceType||"CUSTOMER_UPLOAD";
  if(typeof sourceType!=="string"||!sourceTypes.includes(sourceType as SourceType))throw new AppError(400,"Invalid source type.");
  const permissionNote=raw.permissionNote;
  if(permissionNote!=null&&(typeof permissionNote!=="string"||permissionNote.length>1000))throw new AppError(400,"Permission note is too long.");
  if(raw.permissionConfirmed!==true)throw new AppError(400,"Confirm that you have permission to use this media.");
  const expectedSha256=raw.sha256;
  if(expectedSha256!=null&&(typeof expectedSha256!=="string"||!/^[a-f0-9]{64}$/.test(expectedSha256)))throw new AppError(400,"Invalid SHA-256 checksum.");
  return {purpose:purpose as AssetPurpose,mimeType,type,byteSize,originalFilename,sourceType:sourceType as SourceType,permissionNote:(permissionNote as string|undefined||"").trim(),expectedSha256:expectedSha256 as string|undefined,max};
}

export function signatureMatches(mimeType:string,first:Uint8Array):boolean {
  if(mimeType==="image/jpeg")return first.length>=3&&first[0]===0xff&&first[1]===0xd8&&first[2]===0xff;
  if(mimeType==="image/png")return first.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>first[i]===x);
  if(mimeType==="image/webp")return first.length>=12&&String.fromCharCode(...first.slice(0,4))==="RIFF"&&String.fromCharCode(...first.slice(8,12))==="WEBP";
  if(mimeType==="video/mp4")return first.length>=12&&String.fromCharCode(...first.slice(4,8))==="ftyp"&&String.fromCharCode(...first.slice(8,12))!=="qt  ";
  return false;
}
