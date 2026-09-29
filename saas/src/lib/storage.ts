import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "./core";

export type ObjectHead = { byteSize: number; etag: string | undefined; contentType: string | undefined };
export interface ObjectStorage {
  issueUpload(key: string, mimeType: string, expiresSeconds: number): Promise<string>;
  issueDownload(key: string, filename: string, expiresSeconds: number): Promise<string>;
  head(key: string): Promise<ObjectHead | null>;
  stream(key: string): Promise<AsyncIterable<Uint8Array>>;
  copy(sourceKey: string, targetKey: string, sourceEtag: string | undefined, mimeType: string): Promise<void>;
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

let singleton: ObjectStorage | undefined;

export function storageBucket(): string {
  const bucket = process.env.OBJECT_STORAGE_BUCKET;
  if (!bucket) throw new Error("OBJECT_STORAGE_BUCKET is required");
  return bucket;
}

function client(): S3Client {
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT;
  const region = process.env.OBJECT_STORAGE_REGION;
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_KEY;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey) throw new Error("Object storage is not configured");
  return new S3Client({ endpoint, region, credentials: { accessKeyId, secretAccessKey }, forcePathStyle: true });
}

function notFound(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error.name === "NotFound" || error.name === "NoSuchKey" || error.name === "NoSuchBucket");
}

class S3ObjectStorage implements ObjectStorage {
  private s3 = client();
  private bucket = storageBucket();

  async issueUpload(key: string, mimeType: string, expiresSeconds: number) {
    return getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: mimeType }), { expiresIn: expiresSeconds });
  }

  async issueDownload(key: string, filename: string, expiresSeconds: number) {
    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "asset";
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: `inline; filename="${safeName}"` }), { expiresIn: expiresSeconds });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const result = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
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

  async delete(key: string) { await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
}

export function objectStorage(): ObjectStorage { return singleton ??= new S3ObjectStorage(); }

export function originalObjectKey(workspaceId: string, productId: string, assetId: string, versionId: string): string {
  return `workspaces/${workspaceId}/products/${productId}/assets/${assetId}/versions/${versionId}/original`;
}
export function uploadObjectKey(workspaceId: string, productId: string, assetId: string, versionId: string): string {
  return `pending/workspaces/${workspaceId}/products/${productId}/assets/${assetId}/versions/${versionId}/upload`;
}
export function thumbnailObjectKey(workspaceId: string, productId: string, assetId: string, versionId: string): string {
  return `workspaces/${workspaceId}/products/${productId}/assets/${assetId}/versions/${versionId}/thumbnail.jpg`;
}
