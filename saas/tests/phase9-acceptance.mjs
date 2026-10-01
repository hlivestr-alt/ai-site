import {randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,unlink,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
import {S3Client,GetObjectCommand,HeadBucketCommand,GetPublicAccessBlockCommand} from '@aws-sdk/client-s3';
import {request,chromium} from '@playwright/test';
process.loadEnvFile('.env.local');
if(!process.env.TEST_DATABASE_URL||!process.env.TEST_OBJECT_STORAGE_BUCKET)throw new Error('Isolated test infrastructure required');
const stamp=randomBytes(5).toString('hex'),sourceName=`phase9_source_${stamp}`,restoreName=`phase9_restore_${stamp}`,sourceUrl=new URL(process.env.TEST_DATABASE_URL),restoreUrl=new URL(process.env.TEST_DATABASE_URL),adminUrl=new URL(process.env.TEST_DATABASE_URL);sourceUrl.pathname='/'+sourceName;restoreUrl.pathname='/'+restoreName;adminUrl.pathname='/postgres';
const sourceBucket=`phase9-source-${stamp}`,restoreBucket=`phase9-restore-${stamp}`,backup=resolve('data/backups',`phase9-${stamp}`),admin=new pg.Client({connectionString:adminUrl.toString()});
const env={...process.env,APP_ENV:'local',APP_BASE_URL:'http://127.0.0.1:3200',MAIL_MODE:'development_file',MAIL_PROVIDER:'development_file',DATABASE_URL:sourceUrl.toString(),TEST_DATABASE_URL:sourceUrl.toString(),OBJECT_STORAGE_BUCKET:sourceBucket,TEST_OBJECT_STORAGE_BUCKET:sourceBucket,ENABLE_TEST_BILLING:'1',VIDEO_PROVIDER:'fake',ENABLE_FAKE_VIDEO_PROVIDER:'1',PAYMENT_PROVIDER:'fake',ENABLE_FAKE_PAYMENT_PROVIDER:'1',ENABLE_FAKE_CLIP_ANALYZER:'1',WORKFLOW_MAX_TOKENS:'100000',FAKE_PAYMENT_WEBHOOK_SECRET:'isolated-phase9-webhook-secret-fixture',POSTGRES_TOOLS_CONTAINER:process.env.POSTGRES_TOOLS_CONTAINER||'ai-site-saas-postgres-1'};
const run=(args,selected=env)=>{try{return execFileSync(process.execPath,args,{env:selected,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});}catch(error){if(args[0]==='node_modules/@playwright/test/cli.js')console.error(String(error.stdout).slice(-10000));throw new Error('Phase 9 acceptance command failed');}};
let app;
async function stopApp(){if(!app||app.exitCode!==null||app.signalCode!==null)return;const child=app;app=undefined;const closed=new Promise(resolve=>child.once('exit',resolve));child.kill();await closed;}
async function startApp(selected){app=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','-p','3200','-H','127.0.0.1'],{env:selected,windowsHide:true,stdio:['ignore','ignore','pipe']});app.stderr.resume();for(let i=0;i<150;i++){if(app.exitCode!==null)throw new Error('Acceptance application startup failed');try{const response=await fetch('http://127.0.0.1:3200/api/health',{signal:AbortSignal.timeout(2000)});if(response.ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error('Acceptance application startup timed out');}
const s3=new S3Client({endpoint:env.OBJECT_STORAGE_ENDPOINT,region:env.OBJECT_STORAGE_REGION,credentials:{accessKeyId:env.OBJECT_STORAGE_ACCESS_KEY,secretAccessKey:env.OBJECT_STORAGE_SECRET_KEY},forcePathStyle:true,maxAttempts:2});
await admin.connect();
try{
  await admin.query(`CREATE DATABASE ${sourceName}`);await admin.query(`CREATE DATABASE ${restoreName}`);
  console.log('Phase 9: isolated hardening and process recovery acceptance');
  assert.throws(()=>run(['--import','tsx','scripts/dispatcher.ts','--once'],{...env,APP_ENV:'production'}));
  assert.throws(()=>run(['--import','tsx','scripts/workflow-dispatcher.ts','--once'],{...env,APP_ENV:'production'}));
  console.log(run(['node_modules/@playwright/test/cli.js','test','--config','playwright.phase9.config.ts']).trim());
  const fixture=JSON.parse(await readFile('data/phase9/restore-fixture.json','utf8'));
  console.log('Phase 9: backup failure and destination guards');
  const dumpFailure=backup+'-dump-failure',storageFailure=backup+'-storage-failure';
  assert.throws(()=>run(['--import','tsx','scripts/backup.ts','create',dumpFailure],{...env,POSTGRES_TOOLS_CONTAINER:'',PG_DUMP_PATH:resolve('data/phase9/nonexistent-pg-dump.exe')}));
  assert.equal(JSON.parse(await readFile(join(dumpFailure,'INCOMPLETE.json'),'utf8')).code,'BACKUP_INCOMPLETE');
  await assert.rejects(stat(join(dumpFailure,'manifest.json')));
  assert.throws(()=>run(['--import','tsx','scripts/backup.ts','create',storageFailure],{...env,OBJECT_STORAGE_BUCKET:'phase9-missing-'+stamp}));
  assert.equal(JSON.parse(await readFile(join(storageFailure,'INCOMPLETE.json'),'utf8')).code,'BACKUP_INCOMPLETE');
  assert.throws(()=>run(['--import','tsx','scripts/backup.ts','create',resolve('data/phase9/outside-backup-root-'+stamp)]));
  console.log('Phase 9: coordinated snapshot backup');const created=JSON.parse(run(['--import','tsx','scripts/backup.ts','create',backup]));assert.equal(created.complete,true);
  assert.equal(JSON.parse(run(['--import','tsx','scripts/backup.ts','verify',backup])).verified,true);
  const manifestHashFile=join(backup,'manifest.sha256'),originalHash=await readFile(manifestHashFile);
  try{await writeFile(manifestHashFile,'0'.repeat(64));assert.throws(()=>run(['--import','tsx','scripts/backup.ts','verify',backup]));}finally{await writeFile(manifestHashFile,originalHash);}
  try{await writeFile(join(backup,'INCOMPLETE.json'),'{}');assert.throws(()=>run(['--import','tsx','scripts/backup.ts','verify',backup]));}finally{await unlink(join(backup,'INCOMPLETE.json'));}
  const restoreEnv={...env,DATABASE_URL:restoreUrl.toString(),TEST_DATABASE_URL:restoreUrl.toString(),OBJECT_STORAGE_BUCKET:restoreBucket,TEST_OBJECT_STORAGE_BUCKET:restoreBucket,PLATFORM_OPERATOR_EMAILS:fixture.email};
  const confirmed={...env,RESTORE_DATABASE_URL:restoreUrl.toString(),RESTORE_OBJECT_STORAGE_BUCKET:restoreBucket,RESTORE_CONFIRM_DATABASE:restoreName,RESTORE_CONFIRM_BUCKET:restoreBucket};
  const restored=JSON.parse(run(['--import','tsx','scripts/backup.ts','restore',backup],confirmed));assert.equal(restored.restored,true);assert.ok(restored.objects>0);
  assert.throws(()=>run(['--import','tsx','scripts/backup.ts','restore',backup],confirmed));
  const manifest=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'));
  for(const o of manifest.objects){const response=await s3.send(new GetObjectCommand({Bucket:restoreBucket,Key:o.key})),hash=createHash('sha256');let bytes=0;for await(const chunk of response.Body){bytes+=chunk.length;hash.update(chunk);}assert.equal(bytes,o.bytes);assert.equal(hash.digest('hex'),o.sha256);}
  const privacy=await s3.send(new GetPublicAccessBlockCommand({Bucket:restoreBucket}));assert.ok(Object.values(privacy.PublicAccessBlockConfiguration).every(Boolean));await s3.send(new HeadBucketCommand({Bucket:restoreBucket}));
  await startApp(restoreEnv);const c=await request.newContext({baseURL:env.APP_BASE_URL,extraHTTPHeaders:{Origin:env.APP_BASE_URL}});
  try{
    const signedIn=await c.post('/api/auth/login',{data:{email:fixture.email,password:fixture.password}});assert.equal(signedIn.status(),200);assert.match(signedIn.headers()['set-cookie'],/HttpOnly/i);assert.match(signedIn.headers()['set-cookie'],/SameSite=Lax/i);
    for(const path of ['/products','/content','/workflows','/billing',`/products/${fixture.productId}`,`/workflows/runs/${fixture.workflowId}`,`/workflows/runs/${fixture.clipRun}`,`/content/${fixture.contentId}`])assert.equal((await c.get(path)).status(),200,`Restored page failed: ${path}`);
    const lineage=await (await c.get(`/api/workspaces/${fixture.workspaceId}/workflows/runs/${fixture.workflowId}`)).json();assert.equal(lineage.run.status,'SUCCEEDED');assert.equal(lineage.outputs.length,3);
    const media=await (await c.get(`/api/workspaces/${fixture.workspaceId}/content/${fixture.contentId}/versions/${fixture.versionId}/media`)).json();assert.ok(media.url.includes(restoreBucket));assert.ok((await fetch(media.url)).ok);assert.equal((await fetch(media.url.split('?')[0])).status,403);
    const mediaDb=new pg.Client({connectionString:restoreUrl.toString()});await mediaDb.connect();
    try{
      const asset=(await mediaDb.query("SELECT asset_id FROM asset_versions WHERE workspace_id=$1 AND product_id=$2 AND status='READY' ORDER BY id LIMIT 1",[fixture.workspaceId,fixture.productId])).rows[0];
      for(const variant of ['original','thumbnail']){const r=await c.get(`/api/workspaces/${fixture.workspaceId}/products/${fixture.productId}/assets/${asset.asset_id}/download?variant=${variant}`);assert.equal(r.status(),200);const signed=await r.json();assert.ok(signed.url.includes(restoreBucket));assert.ok((await fetch(signed.url)).ok);}
      const short=await (await c.get(`/api/workspaces/${fixture.workspaceId}/products/${fixture.productId}/assets/${asset.asset_id}/download?testTtl=1`)).json();assert.ok((await fetch(short.url)).ok);await new Promise(r=>setTimeout(r,2100));assert.equal((await fetch(short.url)).status,403);
      const source=await (await c.get(`/api/workspaces/${fixture.workspaceId}/sources/${fixture.sourceId}/download`)).json();assert.ok(source.url.includes(restoreBucket));assert.ok((await fetch(source.url)).ok);
      const versions=(await mediaDb.query('SELECT v.id,v.content_item_id,j.type FROM content_versions v JOIN jobs j ON j.id=v.job_id WHERE v.workspace_id=$1 AND j.workflow_run_id IN($2,$3)',[fixture.workspaceId,fixture.workflowId,fixture.clipRun])).rows;assert.ok(versions.some(v=>v.type==='AI_VIDEO'));assert.ok(versions.some(v=>v.type==='CLIPPER'));
      for(const v of versions)for(const kind of ['preview','poster']){const r=await c.get(`/api/workspaces/${fixture.workspaceId}/content/${v.content_item_id}/versions/${v.id}/media?kind=${kind}`);assert.equal(r.status(),200);const signed=await r.json();assert.ok(signed.url.includes(restoreBucket));assert.ok((await fetch(signed.url)).ok);}
      const chain=await mediaDb.query('SELECT count(*)::int AS n FROM content_versions v JOIN jobs j ON j.id=v.job_id JOIN workflow_steps s ON s.id=j.workflow_step_id JOIN workflow_runs r ON r.id=s.workflow_run_id JOIN workflow_definition_versions d ON d.id=r.definition_version_id WHERE v.workspace_id=$1 AND r.id IN($2,$3)',[fixture.workspaceId,fixture.workflowId,fixture.clipRun]);assert.equal(chain.rows[0].n,versions.length);
      assert.ok((await mediaDb.query('SELECT count(*)::int AS n FROM review_decisions WHERE workspace_id=$1',[fixture.workspaceId])).rows[0].n>=versions.length);
    }finally{await mediaDb.end();}
    const report=JSON.parse(run(['--import','tsx','tests/invoke-phase9.ts','audits'],restoreEnv));assert.ok(Object.values(report.billing).every(rows=>rows.length===0));assert.equal(report.brokenContent.count,'0');assert.equal(report.missingChildren.count,'0');
    const browser=await chromium.launch({channel:'chrome',headless:true});try{const page=await browser.newPage({storageState:await c.storageState()});await page.goto(env.APP_BASE_URL+'/content');assert.equal(await page.getByRole('heading',{name:'Content Library',exact:true}).count(),1);await page.goto(env.APP_BASE_URL+'/workflows/runs/'+fixture.workflowId);assert.equal(await page.getByRole('heading',{name:'Workflow Run',exact:true}).count()>0||await page.locator('h1').count()>0,true);}finally{await browser.close();}
  }finally{await c.dispose();await stopApp();}
  // Storage outage is injected into this isolated restored app, without stopping shared storage.
  await startApp({...restoreEnv,OBJECT_STORAGE_ENDPOINT:'http://127.0.0.1:1'});const outage=await request.newContext({baseURL:env.APP_BASE_URL,extraHTTPHeaders:{Origin:env.APP_BASE_URL}});
  try{
    assert.equal((await outage.get('/api/health')).status(),200);assert.equal((await outage.post('/api/auth/login',{data:{email:fixture.email,password:fixture.password}})).status(),200);
    const ready=await outage.get('/api/readiness');assert.equal(ready.status(),503);
    const media=await outage.get(`/api/workspaces/${fixture.workspaceId}/content/${fixture.contentId}/versions/${fixture.versionId}/media`);assert.equal(media.status(),500);const safe=await media.json();assert.ok(safe.requestId);assert.ok(!JSON.stringify(safe).match(/ECONNREFUSED|127\.0\.0\.1:1|storage_key|SELECT|password/i));
    const upload=await outage.post(`/api/workspaces/${fixture.workspaceId}/sources`,{data:{filename:'isolated-storage-outage.mp4',mimeType:'video/mp4',byteSize:67108865}});assert.equal(upload.status(),503);assert.ok(!(await upload.text()).includes('127.0.0.1:1'));
  }finally{await outage.dispose();await stopApp();}
  const restoredDb=new pg.Client({connectionString:restoreUrl.toString()});await restoredDb.connect();const sourceDb=new pg.Client({connectionString:sourceUrl.toString()});await sourceDb.connect();
  try{const financial=(await restoredDb.query('SELECT available_tokens::text,reserved_tokens::text FROM workspace_wallets WHERE workspace_id=$1',[fixture.workspaceId])).rows[0];await mkdir('data/phase9',{recursive:true});await writeFile('data/phase9/backup-restore-acceptance.json',JSON.stringify({passed:true,backupId:created.id,sourceDatabase:sourceName,restoreDatabase:restoreName,sourceBucket,restoreBucket,objectCount:manifest.objects.length,objectBytes:manifest.objectBytes,dumpSha256:manifest.dump.sha256,allObjectChecksumsVerified:true,privateBucket:true,freshSignedUrls:true,signIn:true,pages:true,lineage:true,financialReconciliation:true,compensationEntriesCreated:0,storageOutageSafe:true,wallet:financial},null,2));}finally{await restoredDb.end();await sourceDb.end();}
  const evidence=await readFile('data/phase9/backup-restore-acceptance.json');
  const receiptFile=resolve('data/phase9/restore-verification-action.json'),checks=Object.fromEntries(['isolatedTargets','database','objectChecksums','privateMedia','signIn','pages','lineage','financialReconciliation','noCompensation'].map(c=>[c,true]));
  await writeFile(receiptFile,JSON.stringify({action:'RECORD_RESTORE_VERIFICATION',targetId:created.id,reason:'Completed isolated restore, application, media and financial checks',dumpSha256:manifest.dump.sha256,evidenceSha256:createHash('sha256').update(evidence).digest('hex'),checks}));
  for(const selected of [env,restoreEnv])assert.equal(JSON.parse(run(['--import','tsx','scripts/operations.ts','action',receiptFile],{...selected,PLATFORM_OPERATOR_EMAILS:fixture.email,OPERATOR_USER_ID:fixture.userId})).accepted,true);
  const auditDb=new pg.Client({connectionString:sourceUrl.toString()});await auditDb.connect();try{assert.equal((await auditDb.query("SELECT count(*)::int AS n FROM audit_events WHERE event_type='BACKUP_RESTORE_VERIFIED' AND target_id=$1",[created.id])).rows[0].n,1);}finally{await auditDb.end();}
  await writeFile('data/phase9/backup-failure-acceptance.json',JSON.stringify({passed:true,pgDumpFailureRejected:true,storageBackupFailureRejected:true,outsideDestinationRejected:true,corruptManifestRejected:true,incompleteBackupRejected:true,usedRestoreTargetRejected:true,productionSimulationStartupRejected:true,freshMediaKinds:['product_original','product_thumbnail','source','ai_preview','clip_preview','posters'],signedExpiry:true,multipartStorageOutageSafe:true},null,2));
  console.log(JSON.stringify({passed:true,restoreDrill:true,backupFailureChecks:true,objectCount:manifest.objects.length,externalPaidCalls:0}));
}finally{await stopApp();s3.destroy();await admin.end();}
