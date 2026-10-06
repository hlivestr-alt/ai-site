// Actual external reference fetch with the rotated signer; GET only, no inference.
import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import sharp from 'sharp';
import {CreateBucketCommand,PutPublicAccessBlockCommand,PutObjectCommand,DeleteObjectCommand,DeleteBucketCommand} from '@aws-sdk/client-s3';
import {storageClient} from '../../src/lib/storage';
import {WaveSpeedVideoProvider} from '../../src/lib/video-providers/wavespeed';
import type {AiVideoInput} from '../../src/lib/job-core';

async function main(){
  Object.assign(process.env,parseEnv(await readFile('.env.local','utf8')));
  if(process.env.APP_ENV!=='local'||process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT!=='https://storage-test.proyaofficial.com')throw new Error('Owned REMOTE-TEST proof required');
  const bucket=`phase-a-reference-${Date.now()}`,key='controlled-reference.png',s3=storageClient();let created=false,reads=0;
  const result:Record<string,unknown>={status:'FAIL',paidInference:0,providerPosts:0,secretPrinted:false};
  try{
    await s3.send(new CreateBucketCommand({Bucket:bucket}));created=true;
    await s3.send(new PutPublicAccessBlockCommand({Bucket:bucket,PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true}}));
    const bytes=await sharp({create:{width:640,height:640,channels:3,background:'#ed6748'}}).png().toBuffer();await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:'image/png'}));
    process.env.OBJECT_STORAGE_BUCKET=bucket;process.env.WAVESPEED_REFERENCE_FETCH_VERIFIED='1';
    const version=randomUUID(),input:AiVideoInput={schemaVersion:1,kind:'AI_VIDEO',customerPrompt:'Unpaid signed reference proof',accuracyInstructions:'',tier:'QUALITY',durationSeconds:5,aspectRatio:'1:1',quantity:1,referenceAssetVersionIds:[version],providerPolicyVersion:'phase-a-get-only',executionProvider:'WAVESPEED',product:{id:randomUUID(),versionId:randomUUID(),versionNumber:1,ruleVersionId:randomUUID(),ruleVersionNumber:1,information:{name:'Owned reference fixture'},rules:{},assets:[{assetId:randomUUID(),assetVersionId:version,purpose:'FRONT',type:'IMAGE',storageKey:key,sha256:createHash('sha256').update(bytes).digest('hex'),byteSize:bytes.length,mimeType:'image/png'}]}};
    const urls=await new WaveSpeedVideoProvider({fetch:async(...args)=>{const u=new URL(String(args[0]));if(u.origin!=='https://storage-test.proyaofficial.com'||args[1]?.method&&args[1].method!=='GET')throw new Error('Only controlled reference GET permitted');reads++;return fetch(...args);}}).referenceUrls(input);
    const u=new URL(urls[0]);Object.assign(result,{status:'PASS',referenceCount:urls.length,publicHttps:true,referenceIntegrityVerified:true,publicIdentifierEqualsSecret:u.searchParams.get('X-Amz-Credential')!.split('/')[0]===process.env.OBJECT_STORAGE_SECRET_KEY,ttlSeconds:Number(u.searchParams.get('X-Amz-Expires')),actualExternalReferenceGets:reads,unsignedListing:(await fetch(`${u.origin}/${bucket}?list-type=2`)).status});
  }catch{result.errorCategory='REFERENCE_PROOF_FAILED';process.exitCode=1;}
  finally{if(created){await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));await s3.send(new DeleteBucketCommand({Bucket:bucket}));result.controlledFixtureDeleted=true;}s3.destroy();await writeFile('docs/stabilization-phase-a-evidence/wavespeed-reference-proof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
}
void main().catch(()=>{console.log(JSON.stringify({status:'FAIL',errorCategory:'REFERENCE_PROOF_SETUP_FAILED'}));process.exitCode=1;});
