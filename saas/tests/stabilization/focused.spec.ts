import {test,expect,chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {GetObjectCommand,HeadObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {base,database,evidence,fixtures,populatedFixtures,login,observe,mediaChecks} from './support';
import {source,submit,provision,worker,dispatch,lease,type Claim} from '../clipper-helpers';
const client=(secret=process.env.OBJECT_STORAGE_SECRET_KEY!)=>new S3Client({endpoint:process.env.OBJECT_STORAGE_ENDPOINT,region:process.env.OBJECT_STORAGE_REGION,forcePathStyle:true,credentials:{accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY!,secretAccessKey:secret}});
const safeError=(text:string)=>!/ECONNREFUSED|127\.0\.0\.1:\d+|PostgreSQL|Traceback|RuntimeError|WORKER_TOKEN|WAVESPEED_API_KEY|Authorization:\s*Bearer/i.test(text);

test('media finalization locks preserve a single-connection query pool and release after failure', async () => {
  const script = `
    import assert from 'node:assert/strict';
    import {randomUUID} from 'node:crypto';
    import {withMediaFinalizeLock,transaction,pool} from './src/lib/db.ts';
    const key='phase-a-pool-'+randomUUID();
    const value=await withMediaFinalizeLock(key,()=>transaction(async db=>(await db.query('SELECT 1 AS value')).rows[0].value));
    assert.equal(value,1);
    await withMediaFinalizeLock(key,async()=>{await assert.rejects(withMediaFinalizeLock(key,async()=>{}),e=>e.status===409);});
    await assert.rejects(withMediaFinalizeLock(key,async()=>{throw new Error('owned failure');}));
    await withMediaFinalizeLock(key,async()=>{});
    const holds=[],release=[];
    for(let i=0;i<4;i++) holds.push(withMediaFinalizeLock(key+'-'+i,()=>new Promise(resolve=>release.push(resolve))));
    while(release.length<4) await new Promise(resolve=>setTimeout(resolve,10));
    await assert.rejects(withMediaFinalizeLock(key+'-overflow',async()=>{}),e=>e.status===503);
    release.forEach(resolve=>resolve());await Promise.all(holds);await pool().end();
    console.log(JSON.stringify({status:'PASS',singleConnectionPool:true,concurrentSameIdentityRejected:true,failureReleasesLock:true,concurrentFinalizationsBounded:true}));
  `;
  const output=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{env:{...process.env,DB_POOL_MAX:'1'},encoding:'utf8',timeout:30000,windowsHide:true});
  const result=JSON.parse(output.trim());expect(result.status).toBe('PASS');await evidence('media-lock',result);
});

test('20 corrupt Product/source media cannot become usable or reserve tokens; valid controls and failed retention',async()=>{
  const f=await fixtures(),c=await login(f.email),db=await database(),s3=client(),checks:unknown[]=[];
  try{
    const before=(await db.query('SELECT available_tokens::text,reserved_tokens::text FROM billing_account_wallets WHERE billing_account_id=(SELECT billing_account_id FROM workspaces WHERE id=$1)',[f.workspaceId])).rows[0];
    const counts=(await db.query('SELECT (SELECT count(*) FROM jobs) jobs,(SELECT count(*) FROM provider_executions) providers,(SELECT count(*) FROM worker_leases) leases,(SELECT count(*) FROM token_ledger_entries) ledger')).rows[0];
    const root=`/api/workspaces/${f.workspaceId}/products/${f.productId}/assets`,failed:string[]=[],sourceIds:string[]=[];
    const cases=[{name:'ftyp-only',mime:'video/mp4',bytes:Buffer.from('xxxxftypisomJUNKJUNK')},{name:'renamed-text',mime:'video/mp4',bytes:Buffer.from('Plain text renamed to an MP4 file')},{name:'broken-png',mime:'image/png',bytes:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])},{name:'mime-mismatch',mime:'image/jpeg',bytes:await readFile('tests/fixtures/fake-video.mp4')},{name:'zero-video',mime:'video/mp4',bytes:Buffer.alloc(0)},{name:'unsupported',mime:'image/gif',bytes:Buffer.from('GIF89a')},{name:'advertised-oversize',mime:'video/mp4',bytes:Buffer.alloc(1),declared:Number(process.env.MAX_VIDEO_BYTES||524288000)+1}];
    for(const item of cases){const r=await c.post(root+'/upload-intents',{data:{purpose:item.mime.startsWith('video')?'PRODUCT_VIDEO':'OTHER',mimeType:item.mime,byteSize:item.declared||item.bytes.length,filename:item.name+'.mp4',permissionConfirmed:true,sourceType:'CUSTOMER_OWNED'}});let status=r.status();if(status===201){const intent=(await r.json()).intent;expect((await fetch(intent.uploadUrl,{method:'PUT',headers:intent.requiredHeaders,body:item.bytes})).status).toBe(200);const done=await c.post(`${root}/${intent.assetId}/versions/${intent.versionId}/finalize`);status=done.status();expect(safeError(await done.text())).toBe(true);expect((await db.query('SELECT status FROM asset_versions WHERE id=$1',[intent.versionId])).rows[0].status).toBe('FAILED');failed.push(intent.versionId);}expect(status).toBeGreaterThanOrEqual(400);checks.push({kind:'product',case:item.name,status});}
    for(const item of cases.filter(x=>x.mime==='video/mp4'&&!x.declared)){const r=await c.post(`/api/workspaces/${f.workspaceId}/sources`,{data:{filename:'corrupt.mp4',mimeType:'video/mp4',byteSize:item.bytes.length}});let status=r.status();if(status===201){const intent=await r.json();expect((await fetch(intent.uploadUrl,{method:'PUT',headers:intent.requiredHeaders,body:item.bytes})).status).toBe(200);const done=await c.post(`/api/workspaces/${f.workspaceId}/sources/${intent.source.id}/finalize`);status=done.status();expect(safeError(await done.text())).toBe(true);expect((await db.query('SELECT status FROM source_assets WHERE id=$1',[intent.source.id])).rows[0].status).toBe('FAILED');const denied=await submit(c,f.workspaceId,intent.source.id,crypto.randomUUID());expect(denied.status()).toBeGreaterThanOrEqual(400);sourceIds.push(intent.source.id);}expect(status).toBeGreaterThanOrEqual(400);checks.push({kind:'source',case:item.name,status});}
    // Legacy accepted uploads must also be probed before quote/admission.
    const legacy=await c.post(`/api/workspaces/${f.workspaceId}/sources`,{data:{filename:'legacy-corrupt.mp4',mimeType:'video/mp4',byteSize:20}});const intent=await legacy.json();const legacyRow=(await db.query('SELECT storage_key FROM source_assets WHERE id=$1',[intent.source.id])).rows[0];
    const {PutObjectCommand}=await import('@aws-sdk/client-s3');await s3.send(new PutObjectCommand({Bucket:process.env.OBJECT_STORAGE_BUCKET,Key:legacyRow.storage_key,Body:Buffer.from('xxxxftypisomJUNKJUNK'),ContentType:'video/mp4'}));await db.query("UPDATE source_assets SET status='UPLOADED',finalized_at=now() WHERE id=$1",[intent.source.id]);expect((await submit(c,f.workspaceId,intent.source.id,crypto.randomUUID())).status()).toBe(422);
    expect((await db.query('SELECT available_tokens::text,reserved_tokens::text FROM billing_account_wallets WHERE billing_account_id=(SELECT billing_account_id FROM workspaces WHERE id=$1)',[f.workspaceId])).rows[0]).toEqual(before);expect((await db.query('SELECT (SELECT count(*) FROM jobs) jobs,(SELECT count(*) FROM provider_executions) providers,(SELECT count(*) FROM worker_leases) leases,(SELECT count(*) FROM token_ledger_entries) ledger')).rows[0]).toEqual(counts);
    const valid=await source(c,f.workspaceId);expect((await db.query('SELECT media_validation_version FROM source_assets WHERE id=$1',[valid.id])).rows[0].media_validation_version).toBe(1);
    const protectedRows=(await db.query('SELECT id,storage_key,upload_key FROM asset_versions WHERE id=$1',[f.versionId])).rows;
    await db.query("UPDATE asset_versions SET failed_at=now()-interval '25 hours' WHERE id=ANY($1::uuid[])",[failed]);await db.query("UPDATE source_assets SET failed_at=now()-interval '25 hours' WHERE id=ANY($1::uuid[])",[sourceIds]);
    const temporary=(await db.query('SELECT upload_key,storage_key FROM asset_versions WHERE id=ANY($1::uuid[]) UNION ALL SELECT upload_key,storage_key FROM source_assets WHERE id=ANY($2::uuid[])',[failed,sourceIds])).rows;
    const run=(apply:boolean)=>execFileSync(process.execPath,['scripts/cleanup-pending.mjs','--test',...(apply?['--apply']:[])],{env:process.env,stdio:'pipe',windowsHide:true});run(false);
    for(const r of temporary)expect((await s3.send(new HeadObjectCommand({Bucket:process.env.OBJECT_STORAGE_BUCKET,Key:r.upload_key}))).ContentLength).toBeGreaterThan(0);
    run(true);for(const r of temporary)for(const key of [r.upload_key,r.storage_key])await expect(s3.send(new HeadObjectCommand({Bucket:process.env.OBJECT_STORAGE_BUCKET,Key:key}))).rejects.toMatchObject({name:'NotFound'});
    for(const r of protectedRows)expect((await s3.send(new HeadObjectCommand({Bucket:process.env.OBJECT_STORAGE_BUCKET,Key:r.storage_key}))).ContentLength).toBeGreaterThan(0);
    expect((await db.query('SELECT status FROM source_assets WHERE id=$1',[valid.id])).rows[0].status).toBe('UPLOADED');
    await evidence('test20',{status:'PASS',checks,legacyAdmissionRejected:true,walletUnchanged:true,providerAndWorkerCountsUnchanged:true,retention:{dryRunPreservedObjects:true,failedObjectsRemoved:temporary.length,readyReferencePreserved:true,validSourcePreserved:true}});
  }finally{await c.dispose();await db.end();s3.destroy();}
});

test('21 scoped signatures reject public-identifier forgery, tampering, expiry and listing',async()=>{
  const f=await fixtures(),c=await login(f.email),other=await login(f.otherEmail),s3=client(),db=await database();
  try{const route=`/api/workspaces/${f.workspaceId}/products/${f.productId}/assets/${f.assetId}/download`,r=await c.get(route);expect(r.status()).toBe(200);const url=(await r.json()).url,u=new URL(url);expect((await fetch(url)).status).toBe(200);const publicId=u.searchParams.get('X-Amz-Credential')!.split('/')[0];expect(publicId===process.env.OBJECT_STORAGE_SECRET_KEY).toBe(false);
    const key=(await db.query('SELECT storage_key FROM asset_versions WHERE id=$1',[f.versionId])).rows[0].storage_key;const attacker=client(publicId);const forged=await getSignedUrl(attacker,new GetObjectCommand({Bucket:process.env.OBJECT_STORAGE_BUCKET,Key:key}),{expiresIn:300});expect((await fetch(forged)).status).toBe(403);attacker.destroy();
    const tampered=new URL(url);tampered.searchParams.set('X-Amz-Signature','0'.repeat(64));expect((await fetch(tampered)).status).toBe(403);const listing=new URL(url);listing.pathname=`/${process.env.OBJECT_STORAGE_BUCKET}`;listing.searchParams.set('list-type','2');expect((await fetch(listing)).status).toBe(403);expect((await fetch(`${process.env.OBJECT_STORAGE_ENDPOINT}/${process.env.OBJECT_STORAGE_BUCKET}?list-type=2`)).status).toBe(403);expect((await other.get(route)).status()).toBe(404);
    const short=await getSignedUrl(s3,new GetObjectCommand({Bucket:process.env.OBJECT_STORAGE_BUCKET,Key:key}),{expiresIn:1});await new Promise(r=>setTimeout(r,2200));expect((await fetch(short)).status).toBe(403);const refreshed=await c.get(route);expect((await fetch((await refreshed.json()).url)).status).toBe(200);await evidence('test21',{status:'PASS',publicIdentifierEqualsSecret:false,publicIdentifierForgery:403,tampered:403,expired:403,listing:403,foreignWorkspace:404,freshUrl:200});
  }finally{await c.dispose();await other.dispose();await db.end();s3.destroy();}
});

test('25 synthetic worker diagnostics and legacy rows produce only catalog messages',async({browser})=>{
  const f=await fixtures(),c=await login(f.email),db=await database(),s=await source(c,f.workspaceId),r=await submit(c,f.workspaceId,s.id,crypto.randomUUID());expect(r.status()).toBe(201);const jobId=(await r.json()).job.id,p=provision(`phase-a-message-${Date.now()}`),w=await worker(p.credential);dispatch();const claim=(await (await w.post('/api/worker/claim',{data:{}})).json()).claim as Claim;expect(claim.jobId).toBe(jobId);
  const marker='ECONNREFUSED 127.0.0.1:9999 PostgreSQL RuntimeError Traceback WORKER_TOKEN synthetic-placeholder';let context;
  try{expect((await w.post(`/api/worker/jobs/${jobId}/progress`,{data:{...lease(claim),sequence:1,percent:20,stage:'TRANSCRIBING',message:marker}})).status()).toBe(200);const detail=`/api/workspaces/${f.workspaceId}/clipper/${jobId}`;expect(safeError(await (await c.get(detail)).text())).toBe(true);expect((await w.post(`/api/worker/jobs/${jobId}/fail`,{data:{...lease(claim),errorCode:'INTERNAL_ERROR',retriable:false,message:marker}})).status()).toBe(200);
    // Read protection covers historical diagnostics without rewriting history.
    await db.query('UPDATE jobs SET progress_message=$1,error_message_safe=$1 WHERE id=$2',[marker,jobId]);expect(safeError(await (await c.get(detail)).text())).toBe(true);expect(safeError(await (await c.get(`/api/workspaces/${f.workspaceId}/jobs/${jobId}`)).text())).toBe(true);
    context=await browser.newContext({storageState:await c.storageState(),baseURL:base});const page=await context.newPage();await page.goto(`/clipper/${jobId}`);await expect(page.getByText('Video processing is temporarily unavailable. Please try again.')).toBeVisible();expect(safeError(await page.locator('body').innerText())).toBe(true);await evidence('test25',{status:'PASS',progressApiSafe:true,failureApiSafe:true,generalJobApiSafe:true,legacyRowReadSafe:true,failedUiSafe:true});
  }finally{await context?.close();await w.dispose();await c.dispose();await db.query("UPDATE workers SET status='DISABLED' WHERE id=$1",[p.workerId]);await db.end();}
});

for(const channel of ['chrome','msedge'] as const)test(`23/26/27 ${channel} critical navigation, media, downloads and clean console`,async()=>{
  const f=await populatedFixtures(),c=await login(f.email),browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({storageState:await c.storageState(),baseURL:base});
  try{const page=await context.newPage(),o=await observe(page,base),routes=['/','/products','/ai-videos','/clipper','/content','/settings','/billing',`/products/${f.productId}/edit?step=assets`];for(const route of routes){expect((await page.goto(route))?.status()).toBe(200);await expect(page.locator('main')).toBeVisible();}
    const media=[];for(const route of [`/ai-videos/${f.aiJobId}`,`/clipper/${f.clipJobId}`,`/content/${f.aiContentId}`]){await page.goto(route);media.push(...await mediaChecks(page));}
    const content=(await (await c.get(`/api/workspaces/${f.workspaceId}/content/${f.aiContentId}`)).json()).content;
    for(const route of [`/api/workspaces/${f.workspaceId}/content/${f.aiContentId}/versions/${content.version.id}/media?kind=download`,`/api/workspaces/${f.workspaceId}/sources/${f.sourceId}/download`]){const response=await c.get(route);expect(response.status()).toBe(200);expect((await fetch((await response.json()).url)).status).toBe(200);}
    expect((await c.get('/favicon.ico')).status()).toBe(200);await o.finish();await evidence(`test23-26-27-${channel}`,{status:o.crashes.length||o.consoleErrors.length||o.leaks.length||o.network.length?'FAIL':'PASS',browserVersion:browser.version(),routes,media,consoleErrors:o.consoleErrors,uncaught:o.crashes,networkFailures:o.network,requestFailures:o.failed,secretCategories:o.leaks,scannedResponses:o.scannedResponses});expect(o.crashes).toEqual([]);expect(o.consoleErrors).toEqual([]);expect(o.leaks).toEqual([]);expect(o.network).toEqual([]);
  }finally{await context.close();await browser.close();await c.dispose();}
});
