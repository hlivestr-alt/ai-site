// Owns only uniquely named databases/buckets/gateways. Never runs paid providers.
import {spawn,execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir,unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import pg from 'pg';
import {S3Client,CreateBucketCommand,PutPublicAccessBlockCommand,ListObjectsV2Command,DeleteObjectsCommand,DeleteBucketCommand,ListMultipartUploadsCommand,AbortMultipartUploadCommand} from '@aws-sdk/client-s3';

const original={...process.env,...parseEnv(await readFile('.env.local','utf8'))};
const suite=process.argv[process.argv.indexOf('--suite')+1];
if(!['integration','browser','focused','restart','restart-bounds'].includes(suite))throw new Error('Use --suite integration|browser|focused|restart|restart-bounds');
if(original.DATABASE_URL===original.TEST_DATABASE_URL)throw new Error('Separate test database administration is required');
const runId=`${Date.now()}_${randomBytes(3).toString('hex')}`,database=`phase_a_${runId}`,bucket=`phase-a-${runId.replaceAll('_','-')}`,gateway=`phase-a-gateway-${runId.replaceAll('_','-')}`;
const directory=`test-data/stabilization-phase-a/${suite}`;await mkdir(directory,{recursive:true});await mkdir('docs/stabilization-phase-a-evidence',{recursive:true});
const tsconfigOriginal=await readFile('tsconfig.json','utf8');
const adminUrl=new URL(original.TEST_DATABASE_URL),isolatedUrl=new URL(adminUrl);isolatedUrl.pathname=`/${database}`;
const db=new pg.Client({connectionString:adminUrl.toString()});
const s3=new S3Client({endpoint:original.OBJECT_STORAGE_ENDPOINT,region:original.OBJECT_STORAGE_REGION,forcePathStyle:true,credentials:{accessKeyId:original.OBJECT_STORAGE_ACCESS_KEY,secretAccessKey:original.OBJECT_STORAGE_SECRET_KEY}});
const access=`phase-a-${randomBytes(8).toString('hex')}`,secret=randomBytes(32).toString('base64url');
const env={...original,STABILIZATION_RUN_ID:runId,STABILIZATION_SUITE:suite,SAAS_TEST_PORT:'3227',SAAS_TEST_BASE_URL:'http://127.0.0.1:3227',APP_ENV:'local',APP_BASE_URL:'http://127.0.0.1:3227',DATABASE_URL:isolatedUrl.toString(),TEST_DATABASE_URL:isolatedUrl.toString(),OBJECT_STORAGE_BUCKET:bucket,TEST_OBJECT_STORAGE_BUCKET:bucket,OBJECT_STORAGE_ENDPOINT:'http://127.0.0.1:9027',OBJECT_STORAGE_PUBLIC_ENDPOINT:'',OBJECT_STORAGE_ACCESS_KEY:access,OBJECT_STORAGE_SECRET_KEY:secret,OBJECT_STORAGE_ALLOWED_ORIGINS:'http://127.0.0.1:3227',SAAS_TEST_STORAGE_PORT:'9027',STABILIZATION_GATEWAY:gateway,VIDEO_PROVIDER:'fake',ENABLE_FAKE_VIDEO_PROVIDER:'1',CLIP_ANALYZER_PROVIDER:'fake',ENABLE_FAKE_CLIP_ANALYZER:'1',PAYMENT_PROVIDER:'fake',ENABLE_FAKE_PAYMENT_PROVIDER:'1',ENABLE_TEST_BILLING:'1',MAIL_MODE:'development_file',FAKE_PAYMENT_WEBHOOK_SECRET:'isolated-phase-a-test-webhook-only',WAVESPEED_API_KEY:'',BYTEPLUS_ARK_API_KEY:'',OPENAI_API_KEY:'',XENDIT_SECRET_KEY:'',SMTP_PASSWORD:'',JOB_RETRY_BASE_MS:'1000',WORKER_LEASE_SECONDS:'30'};
const values=[secret,...Object.entries(original).filter(([k,v])=>/KEY|TOKEN|SECRET|PASSWORD/.test(k)&&v?.length>=8).map(([,v])=>v)];
for(const k of ['DATABASE_URL','TEST_DATABASE_URL']){const u=new URL(original[k]);if(u.password)values.push(decodeURIComponent(u.password));}
function redact(raw){let t=String(raw);for(const v of values)t=t.split(v).join('[REDACTED]');return t.replace(/wk_[0-9a-f-]{36}\.[A-Za-z0-9_-]{30,100}/gi,'[WORKER_CREDENTIAL]').replace(/https?:\/\/[^\s"'<>]*[?&]X-Amz-[^\s"'<>]*/gi,'[SIGNED_OBJECT_URL]');}
const result={runId,suite,database,bucket,gateway,commands:[],cleanup:{},paid:{realVideo:0,realLLM:0,outreach:0}};let dbCreated=false,bucketCreated=false,gatewayCreated=false,exitCode=0;
async function command(label,executable,args){const started=Date.now();const r=await new Promise(resolve=>{let output='';const child=spawn(executable,args,{env,cwd:process.cwd(),stdio:['ignore','pipe','pipe'],windowsHide:true});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',()=>resolve({code:127,output:'Command could not start.'}));child.on('close',code=>resolve({code,output}));});const safe=redact(r.output);await writeFile(`${directory}/${label}.log`,safe);result.commands.push({command:label,exitCode:r.code,seconds:Math.round((Date.now()-started)/1000)});console.log(`${label}: exit ${r.code}`);if(label.includes('test'))console.log(safe.slice(-12000));return r.code;}
try{
  await db.connect();await db.query(`CREATE DATABASE "${database}"`);dbCreated=true;
  await s3.send(new CreateBucketCommand({Bucket:bucket}));bucketCreated=true;await s3.send(new PutPublicAccessBlockCommand({Bucket:bucket,PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true}}));
  const networks=JSON.parse(execFileSync('docker',['inspect','ai-site-saas-object-storage-1','--format','{{json .NetworkSettings.Networks}}'],{encoding:'utf8',windowsHide:true}));const network=Object.keys(networks)[0];if(!network)throw new Error('Private storage network unavailable');
  const args=['run','-d','--name',gateway,'--label','stabilization-phase-a=owned','--network',network,'-p','127.0.0.1:9027:9000','-v',`${process.cwd().replaceAll('\\','/')}/docker:/app:ro`];
  for(const key of ['APP_ENV','SAAS_TEST_STORAGE_PORT','OBJECT_STORAGE_ENDPOINT','OBJECT_STORAGE_PUBLIC_ENDPOINT','OBJECT_STORAGE_ALLOWED_ORIGINS','OBJECT_STORAGE_REGION','OBJECT_STORAGE_ACCESS_KEY','OBJECT_STORAGE_SECRET_KEY'])args.push('-e',key);args.push('node:22-alpine','node','/app/s3-gateway.mjs');
  execFileSync('docker',args,{env:{...env,APP_ENV:'test'},stdio:'pipe',windowsHide:true});gatewayCreated=true;
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:9027/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  if(await command('migrations',process.execPath,['scripts/migrate.mjs','up']))throw new Error('Isolated migration failed');
  if(suite==='integration'||suite==='browser')exitCode=await command(`npm run test:${suite==='integration'?'integration':'browser'}`,'cmd.exe',['/d','/c','npm','run',`test:${suite==='integration'?'integration':'browser'}`]);
  else exitCode=await command(`focused tests (${suite})`,process.execPath,['node_modules/@playwright/test/cli.js','test','-c','playwright.stabilization.config.ts',...(suite==='restart'?['restart.spec.ts']:suite==='restart-bounds'?['restart.spec.ts','--grep','lost leases']:['focused.spec.ts'])]);
}catch{exitCode=2;result.harnessError='ISOLATED_TEST_RUN_FAILED';}
finally{
  let isolated;
  if(dbCreated)try{isolated=new pg.Client({connectionString:isolatedUrl.toString()});await isolated.connect();result.fixtureCounts={};for(const table of ['users','workspaces','products','asset_versions','source_assets','jobs','job_attempts','job_artifacts','clipper_checkpoints','content_items','token_ledger_entries'])result.fixtureCounts[table]=Number((await isolated.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count);const emails=new Set((await isolated.query('SELECT email FROM users')).rows.map(r=>r.email));let removed=0;for(const n of (await readdir('data/mailbox').catch(()=>[])).filter(n=>n.endsWith('.json')))try{const mail=JSON.parse(await readFile(`data/mailbox/${n}`,'utf8'));if(emails.has(mail.to)){await unlink(`data/mailbox/${n}`);removed++;}}catch{}result.cleanup.mailFiles=removed;}catch{}finally{await isolated?.end().catch(()=>{});}
  if(bucketCreated)try{let keyMarker,uploadMarker;do{const r=await s3.send(new ListMultipartUploadsCommand({Bucket:bucket,KeyMarker:keyMarker,UploadIdMarker:uploadMarker}));for(const u of r.Uploads||[])await s3.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:u.Key,UploadId:u.UploadId}));keyMarker=r.IsTruncated?r.NextKeyMarker:undefined;uploadMarker=r.NextUploadIdMarker;}while(keyMarker);let token,total=0;do{const r=await s3.send(new ListObjectsV2Command({Bucket:bucket,ContinuationToken:token}));if(r.Contents?.length){await s3.send(new DeleteObjectsCommand({Bucket:bucket,Delete:{Objects:r.Contents.map(o=>({Key:o.Key}))}}));total+=r.Contents.length;}token=r.IsTruncated?r.NextContinuationToken:undefined;}while(token);await s3.send(new DeleteBucketCommand({Bucket:bucket}));result.cleanup.bucket='deleted';result.cleanup.objectsDeleted=total;}catch{result.cleanup.bucket='failed';exitCode||=2;}
  if(gatewayCreated)try{execFileSync('docker',['rm','-f',gateway],{stdio:'pipe',windowsHide:true});result.cleanup.gateway='deleted';}catch{result.cleanup.gateway='failed';exitCode||=2;}
  if(dbCreated)try{await db.query(`DROP DATABASE "${database}" WITH (FORCE)`);result.cleanup.database='deleted';}catch{result.cleanup.database='failed';exitCode||=2;}
  await db.end().catch(()=>{});s3.destroy();
  try{const current=JSON.parse(await readFile('tsconfig.json','utf8')),before=JSON.parse(tsconfigOriginal);for(const o of [current,before])o.include=o.include.filter(p=>!p.startsWith('.next-tests/'));if(JSON.stringify(current)===JSON.stringify(before)){await writeFile('tsconfig.json',tsconfigOriginal);result.cleanup.generatedTsconfigChanges='restored';}}catch{}
  result.exitCode=exitCode;await writeFile(`docs/stabilization-phase-a-evidence/${suite}-run.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({suite,exitCode,cleanup:result.cleanup,paid:result.paid}));
}
process.exitCode=exitCode;
