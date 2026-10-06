import { S3Client, HeadBucketCommand, CreateBucketCommand, PutBucketCorsCommand, PutPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import { assertStorageCredentials, allowedStorageOrigins, storageBrowserMethods, storageBrowserHeaders, storageExposedHeaders } from "../docker/storage-gateway-config.mjs";

if (process.env.APP_ENV !== "local") throw new Error("storage:init is local-only");
assertStorageCredentials();
const endpoint=process.env.OBJECT_STORAGE_ENDPOINT;
const port=process.env.SAAS_TEST_STORAGE_PORT||"9000";
if(!/^\d+$/.test(port)||Number(port)<1024||Number(port)>65535||process.env.SAAS_TEST_STORAGE_PORT&&process.env.OBJECT_STORAGE_BUCKET!==process.env.TEST_OBJECT_STORAGE_BUCKET)throw new Error("Isolated test storage target required");
if (!endpoint || ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(endpoint)) throw new Error("storage:init requires local S3 gateway endpoint");
const client=new S3Client({endpoint,region:process.env.OBJECT_STORAGE_REGION||"us-east-1",credentials:{accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY,secretAccessKey:process.env.OBJECT_STORAGE_SECRET_KEY},forcePathStyle:true});
const origins=allowedStorageOrigins();
for(const bucket of [process.env.OBJECT_STORAGE_BUCKET,process.env.TEST_OBJECT_STORAGE_BUCKET]) {
  if(!bucket) throw new Error("Both development and test buckets are required");
  try {await client.send(new HeadBucketCommand({Bucket:bucket}));}
  catch(error) {
    if(error?.$metadata?.httpStatusCode!==404) throw error;
    await client.send(new CreateBucketCommand({Bucket:bucket}));
  }
  await client.send(new PutPublicAccessBlockCommand({Bucket:bucket,PublicAccessBlockConfiguration:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true}}));
  await client.send(new PutBucketCorsCommand({Bucket:bucket,CORSConfiguration:{CORSRules:[{AllowedMethods:storageBrowserMethods,AllowedOrigins:origins,AllowedHeaders:storageBrowserHeaders,ExposeHeaders:storageExposedHeaders,MaxAgeSeconds:300}]}}));
  console.log(`Private local bucket ready: ${bucket}`);
}
client.destroy();
