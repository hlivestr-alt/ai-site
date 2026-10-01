import { HeadBucketCommand, AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, ListPartsCommand, UploadPartCommand, UploadPartCopyCommand, CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "./core";
import { createReadStream } from "node:fs";

export type ObjectHead = { byteSize: number; etag: string | undefined; contentType: string | undefined };
export type UploadPart={partNumber:number;etag:string;byteSize:number};
export interface ObjectStorage {
  createMultipart(key:string,mimeType:string):Promise<string>;
  issuePart(key:string,uploadId:string,partNumber:number,expiresSeconds:number):Promise<string>;
  listParts(key:string,uploadId:string):Promise<UploadPart[]>;
  completeMultipart(key:string,uploadId:string,parts:UploadPart[]):Promise<void>;
  abortMultipart(key:string,uploadId:string):Promise<void>;
  copyLarge(sourceKey:string,targetKey:string,head:ObjectHead,mimeType:string):Promise<void>;
  issueUpload(key: string, mimeType: string, expiresSeconds: number): Promise<string>;
  issueDownload(key: string, filename: string, expiresSeconds: number, attachment?: boolean): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
  stream(key: string): Promise<AsyncIterable<Uint8Array>>;
  copy(sourceKey: string, targetKey: string, sourceEtag: string | undefined, mimeType: string): Promise<void>;
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  putFile(key: string, path: string, byteSize: number, mimeType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

let singleton: ObjectStorage | undefined;

export function storageBucket(): string {
  const bucket = process.env.OBJECT_STORAGE_BUCKET;
  if (!bucket) throw new Error("OBJECT_STORAGE_BUCKET is required");
  return bucket;
}

export function storageClient(): S3Client {
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
  const region = process.env.OBJECT_STORAGE_REGION;
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_KEY;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) throw new Error("Object storage is not configured");
    return new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true, maxAttempts: 2, requestHandler: { connectionTimeout: 5000, requestTimeout: 120000, socketTimeout: 30000 } });
}

function notFound(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error.name === "NotFound" || error.name === "NoSuchKey" || error.name === "NoSuchBucket");
}

class S3ObjectStorage implements ObjectStorage {
  private s3 = storageClient();
  private bucket = storageBucket();

  async createMultipart(key:string,mimeType:string){const r=await this.s3.send(new CreateMultipartUploadCommand({Bucket:this.bucket,Key:key,ContentType:mimeType}));if(!r.UploadId)throw new AppError(503,"Upload unavailable.");return r.UploadId;}
  async issuePart(key:string,uploadId:string,partNumber:number,expiresSeconds:number){return getSignedUrl(this.s3,new UploadPartCommand({Bucket:this.bucket,Key:key,UploadId:uploadId,PartNumber:partNumber}),{expiresIn:expiresSeconds});}
  async listParts(key:string,uploadId:string){const parts:UploadPart[]=[];let marker:string|undefined;do{const r=await this.s3.send(new ListPartsCommand({Bucket:this.bucket,Key:key,UploadId:uploadId,PartNumberMarker:marker}));for(const p of r.Parts||[])if(p.PartNumber&&p.ETag)parts.push({partNumber:p.PartNumber,etag:p.ETag,byteSize:Number(p.Size)});marker=r.IsTruncated?r.NextPartNumberMarker:undefined;}while(marker);return parts.sort((a,b)=>a.partNumber-b.partNumber);}
  async completeMultipart(key:string,uploadId:string,parts:UploadPart[]){await this.s3.send(new CompleteMultipartUploadCommand({Bucket:this.bucket,Key:key,UploadId:uploadId,MultipartUpload:{Parts:parts.map(p=>({PartNumber:p.partNumber,ETag:p.etag}))}}));}
  async abortMultipart(key:string,uploadId:string){await this.s3.send(new AbortMultipartUploadCommand({Bucket:this.bucket,Key:key,UploadId:uploadId}));}
  async copyLarge(sourceKey:string,targetKey:string,head:ObjectHead,mimeType:string){
    if(head.byteSize<=5*1024**3){await this.copy(sourceKey,targetKey,head.etag,mimeType);return;}
    const uploadId=await this.createMultipart(targetKey,mimeType);const parts:UploadPart[]=[];const partSize=256*1024**2;
    try{for(let offset=0;offset<head.byteSize;offset+=partSize){const end=Math.min(head.byteSize-1,offset+partSize-1),partNumber=parts.length+1;const r=await this.s3.send(new UploadPartCopyCommand({Bucket:this.bucket,Key:targetKey,UploadId:uploadId,PartNumber:partNumber,CopySource:`${this.bucket}/${sourceKey}`,CopySourceIfMatch:head.etag,CopySourceRange:`bytes=${offset}-${end}`}));if(!r.CopyPartResult?.ETag)throw new AppError(503,"Source sealing unavailable.");parts.push({partNumber,etag:r.CopyPartResult.ETag,byteSize:end-offset+1});}await this.completeMultipart(targetKey,uploadId,parts);}catch(e){await this.abortMultipart(targetKey,uploadId).catch(()=>{});throw e;}
  }

  async issueUpload(key: string, mimeType: string, expiresSeconds: number) {
    return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType }), { expiresIn: expiresSeconds });
  }

  async issueDownload(key: string, filename: string, expiresSeconds: number, attachment=false) {
    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "asset";
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `${attachment?"attachment":"inline"}; filename="${safeName}"` }), { expiresIn: expiresSeconds });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }),{abortSignal:AbortSignal.timeout(5000)});
      return { byteSize: Number(result.ContentLength ?? 0), etag: result.ETag, contentType: result.ContentType };
    } catch (error) { if (notFound(error)) return null; throw error; }
  }

  async stream(key: string): Promise<AsyncIterable<Uint8Array>> {
    try {
      const result = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body || !(Symbol.asyncIterator in result.Body)) throw new AppError(503, "Storage response is unavailable.");
      return result.Body as AsyncIterable<Uint8Array>;
    } catch (error) { if (notFound(error)) throw new AppError(404, "Media object is unavailable."); throw error; }
  }

  async copy(sourceKey: string, targetKey: string, sourceEtag: string | undefined, mimeType: string) {
    await this.s3.send(new CopyObjectCommand({ Bucket: this.bucket, Key: targetKey, CopySource: `${this.bucket}/${sourceKey}`, CopySourceIfMatch: sourceEtag, ContentType: mimeType, MetadataDirective: "REPLACE" }));
  }

  async put(key: string, bytes: Uint8Array, mimeType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: mimeType }));
  }

  async putFile(key: string, path: string, byteSize: number, mimeType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(path), ContentLength: byteSize, ContentType: mimeType }));
  }

  async delete(key: string) { await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
}

export function objectStorage(): ObjectStorage { return singleton ??= new S3ObjectStorage(); }
export async function storageReachable(){const s3=storageClient();try{await s3.send(new HeadBucketCommand({Bucket:storageBucket()}),{abortSignal:AbortSignal.timeout(5000)});}finally{s3.destroy();}}

export function originalObjectKey(workspaceId: string, productId: string, assetId: string, versionId: string): string {
  return `workspaces/${workspaceId}/products/${productId}/assets/${assetId}/versions/${versionId}/original`;
}
export function uploadObjectKey(workspaceId: string, productId: string, assetId: string, versionId: string): string {
  return `pending/workspaces/${workspaceId}/products/${productId}/assets/${assetId}/versions/${versionId}/upload`;
}
export function thumbnailObjectKey(workspaceId: string, productId: string, assetId: string, versionId: string): string {
  return `workspaces/${workspaceId}/products/${productId}/assets/${assetId}/versions/${versionId}/thumbnail.jpg`;
}
