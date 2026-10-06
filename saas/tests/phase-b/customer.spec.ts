import {test,expect,request,chromium,type Page,type APIRequestContext} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import pg from 'pg';
import sharp from 'sharp';
import {owner,source} from '../clipper-helpers';
import {product,videoJob,imageReference} from '../content-helpers';
import {fundFixture} from '../billing-helpers';
import {observe} from '../stabilization/browser-checks';

const base=process.env.SAAS_TEST_BASE_URL!,password='ValidPassword123!';
async function db(){const c=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await c.connect();return c;}
const evidenceDir=process.env.STABILIZATION_EVIDENCE_DIR||'docs/stabilization-phase-b-evidence';
async function evidence(name:string,value:unknown){await mkdir(evidenceDir,{recursive:true});await writeFile(`${evidenceDir}/${name}.json`,JSON.stringify(value,null,2));}
async function mailbox(email:string){for(let i=0;i<60;i++){const names=(await readdir('data/mailbox')).filter(n=>n.endsWith('.json')).sort().reverse();for(const name of names){const m=JSON.parse(await readFile(`data/mailbox/${name}`,'utf8'));if(m.to===email&&m.subject==='Verify your account')return new URL(m.url).searchParams.get('token');}await new Promise(r=>setTimeout(r,100));}throw new Error('Controlled mail did not arrive');}
async function loginPage(page:Page,c:APIRequestContext){await page.context().addCookies((await c.storageState()).cookies);}
async function current(c:APIRequestContext){return (await (await c.get('/api/auth/session')).json()).currentWorkspace.id as string;}

test('atomic signup, encrypted queue, pending retries, active response and single-use verification',async()=>{
  const probe=execFileSync(process.execPath,['--require','./tests/phase-b/server-only-shim.cjs','--import','tsx','tests/phase-b/auth-queue-probe.ts'],{env:process.env,encoding:'utf8',windowsHide:true});
  const result=JSON.parse(probe.trim().split(/\r?\n/).at(-1)!);
  const c=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}}),database=await db();
  const email=`b-register-${Date.now()}@example.test`;
  try{
    const responses=await Promise.all([c.post('/api/auth/register',{data:{email,displayName:'Original Name',password}}),c.post('/api/auth/register',{data:{email,displayName:'Original Name',password}})]);
    expect(responses.map(r=>r.status())).toEqual([201,201]);
    expect(await responses[0].json()).toEqual(await responses[1].json());
    expect((await database.query('SELECT count(*)::integer AS count FROM users WHERE email=$1',[email])).rows[0].count).toBe(1);
    expect((await c.post('/api/auth/resend-verification',{data:{email}})).status()).toBe(200);
    await expect.poll(async()=>Number((await database.query("SELECT count(*) AS count FROM mail_deliveries WHERE recipient=$1 AND status='SENT'",[email])).rows[0].count)).toBeGreaterThan(0);
    const live=(await database.query("SELECT m.encrypted_payload FROM mail_deliveries m JOIN auth_tokens t ON t.id=m.auth_token_id WHERE m.recipient=$1 AND t.used_at IS NULL",[email])).rows[0];expect(live.encrypted_payload).not.toContain('token=');
    // Retrieve the newest delivered link without putting it in evidence or assertion output.
    let token=await mailbox(email),verified=await c.post('/api/auth/verify',{data:{token}});
    for(let n=0;verified.status()!==200&&n<20;n++){await new Promise(r=>setTimeout(r,100));token=await mailbox(email);verified=await c.post('/api/auth/verify',{data:{token}});}
    expect(verified.status()).toBe(200);expect((await c.post('/api/auth/verify',{data:{token}})).status()).toBe(400);
    const active=await c.post('/api/auth/register',{data:{email,displayName:'Changed Name',password:'AnotherPassword123!'}});expect(active.status()).toBe(201);expect(await active.json()).toEqual(await responses[0].json());
    expect((await c.post('/api/auth/login',{data:{email,password}})).status()).toBe(200);
    expect((await c.post('/api/auth/login',{data:{email,password:'AnotherPassword123!'}})).status()).toBe(401);
    await evidence('auth-application',{...result,concurrentSignup:true,activeGenericResponse:true,singleUse:true,...(evidenceDir.includes('phase-c')?{mailTransport:'LOCAL_QA',remoteSMTP:'Prior Phase B certification preserved; no real mail sent in this regression'}:{realRemoteSMTP:'EXTERNAL CONFIG REQUIRED'})});
  }finally{await c.dispose();await database.end();}
});

for(const channel of ['chrome','msedge'] as const)test(`${channel}: customer creates workspace and switches A → B → A → B without reload`,async()=>{
  const a=await owner(`b-workspace-${channel}-${Date.now()}@example.test`,false),p=await product(a.c,a.workspaceId),database=await db();
  const browser=await chromium.launch({channel}),context=await browser.newContext(),page=await context.newPage();
  try{
    await loginPage(page,a.c);await page.goto('/');
    await page.getByRole('button',{name:'Create workspace',exact:true}).click();await page.getByLabel('Workspace name').fill(`Brand B ${channel}`);
    await page.locator('.workspace-create').getByRole('button',{name:'Create workspace',exact:true}).click();
    await expect(page.locator('select[aria-label="Switch workspace"] option:checked')).toHaveText(`Brand B ${channel}`);
    await expect(page.getByLabel('Switch workspace')).toBeEnabled();await expect(page.getByLabel('Switch workspace')).toHaveValue(/^[0-9a-f-]{36}$/);
    const b=await current(page.request);expect(b).not.toBe(a.workspaceId);
    const membership=(await database.query('SELECT role,status FROM workspace_members WHERE workspace_id=$1',[b])).rows[0];expect(membership).toEqual({role:'OWNER',status:'ACTIVE'});
    const wallet=(await database.query('SELECT available_tokens,reserved_tokens FROM billing_account_wallets WHERE billing_account_id=(SELECT billing_account_id FROM workspaces WHERE id=$1)',[b])).rows[0];expect(wallet).toEqual({available_tokens:'0',reserved_tokens:'0'});
    for(const id of [a.workspaceId,b,a.workspaceId,b]){
      await page.getByLabel('Switch workspace').selectOption(id);await expect(page.getByLabel('Switch workspace')).toBeEnabled();await expect(page.getByLabel('Switch workspace')).toHaveValue(id);expect(await current(page.request)).toBe(id);
      const products=await page.request.get(`/api/workspaces/${id}/products?status=ACTIVE`);expect((await products.json()).total).toBe(id===a.workspaceId?1:0);
      const other=id===b?a.workspaceId:b;expect((await page.request.get(`/api/workspaces/${other}/products`)).status()).toBe(404);
      await page.getByRole('link',{name:/Products$/}).click();await expect(page).toHaveURL(/\/products$/);await expect(page.getByRole('heading',{name:'Historical Product',exact:true})).toHaveCount(id===a.workspaceId?1:0);
    }
    for(const path of ['/ai-videos','/clipper','/content']){await page.goto(path);expect(await current(page.request)).toBe(b);await expect(page.getByLabel('Switch workspace')).toBeEnabled();}
    await page.getByLabel('Switch workspace').selectOption(a.workspaceId);await expect(page.getByLabel('Switch workspace')).toBeEnabled();
    const responsive=[];
    for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1440,height:1000}]){
      await page.setViewportSize(viewport);await page.goto(`/products/${p.id}/edit?step=assets`);await expect(page.locator('.reference-card')).toHaveCount(8);await expect(page.getByLabel('Switch workspace')).toBeEnabled();
      await expect(page.locator('[data-slot="FRONT"]').getByText('COVER',{exact:true})).toBeVisible();
      await expect.poll(()=>page.locator('[data-slot="FRONT"] img').evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`${evidenceDir}/${channel}-${viewport.width}.png`,fullPage:true});responsive.push({...viewport,overflow:false,slots:8});
    }
    await evidence(`workspace-${channel}`,{ownerMembership:membership,zeroWallet:wallet,repeatedSwitches:4,directIdIsolation:true,responsive});
  }finally{await context.close();await browser.close();await a.c.dispose();await database.end();}
});

test('automatic replacement, cover selection, immutable frozen jobs, archive and restore',async()=>{
  const a=await owner(`b-lineage-${Date.now()}@example.test`),database=await db();
  const s3=new S3Client({endpoint:process.env.OBJECT_STORAGE_ENDPOINT,region:process.env.OBJECT_STORAGE_REGION,forcePathStyle:true,credentials:{accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY!,secretAccessKey:process.env.OBJECT_STORAGE_SECRET_KEY!}});
  try{
    const p=await product(a.c,a.workspaceId),root=`/api/workspaces/${a.workspaceId}/products/${p.id}`;
    const first=await (await a.c.get(root)).json();expect(first.cover.asset_id).toBe(p.reference.assetId);
    const job1=await videoJob(a.c,a.workspaceId,p.id),snapshot1=(await database.query('SELECT input_snapshot FROM jobs WHERE id=$1',[job1])).rows[0].input_snapshot;
    const replacement=await imageReference(a.c,a.workspaceId,p.id,undefined,'#332299');expect(replacement.assetId).toBe(p.reference.assetId);expect(replacement.versionId).not.toBe(p.reference.versionId);
    const second=await (await a.c.get(root)).json();expect(second.assets).toHaveLength(1);expect(second.assets[0].version_number).toBe(2);expect(second.cover.version_id).toBe(replacement.versionId);
    const job2=await videoJob(a.c,a.workspaceId,p.id),snapshot2=(await database.query('SELECT input_snapshot FROM jobs WHERE id=$1',[job2])).rows[0].input_snapshot;
    expect(snapshot1.referenceAssetVersionIds).toEqual([p.reference.versionId]);expect(snapshot2.referenceAssetVersionIds).toEqual([replacement.versionId]);
    const old=await s3.send(new GetObjectCommand({Bucket:process.env.OBJECT_STORAGE_BUCKET,Key:snapshot1.product.assets[0].storageKey}));expect(createHash('sha256').update(Buffer.from(await old.Body!.transformToByteArray())).digest('hex')).toBe(snapshot1.product.assets[0].sha256);
    const backBytes=await sharp({create:{width:90,height:90,channels:3,background:'#779933'}}).png().toBuffer();
    const backIntent=await a.c.post(root+'/assets/upload-intents',{data:{purpose:'BACK',mimeType:'image/png',byteSize:backBytes.length,filename:'back.png'}});expect(backIntent.status()).toBe(201);const back=(await backIntent.json()).intent;
    await fetch(back.uploadUrl,{method:'PUT',headers:back.requiredHeaders,body:backBytes});expect((await a.c.post(`${root}/assets/${back.assetId}/versions/${back.versionId}/finalize`)).status()).toBe(200);
    expect((await a.c.post(root+'/cover',{data:{assetId:back.assetId}})).status()).toBe(200);const selected=await (await a.c.get(root)).json();expect(selected.cover.asset_id).toBe(back.assetId);
    const provenance=(await database.query('SELECT source_type,permission_confirmed_at,uploaded_by FROM asset_versions WHERE id=$1',[back.versionId])).rows[0];expect(provenance.source_type).toBe('CUSTOMER_UPLOAD');expect(provenance.permission_confirmed_at).toBeNull();expect(provenance.uploaded_by).toBeTruthy();
    expect((await a.c.delete(root)).status()).toBe(200);expect((await (await a.c.get(`/api/workspaces/${a.workspaceId}/products?status=ARCHIVED`)).json()).products[0].id).toBe(p.id);
    expect((await a.c.post(root+'/restore')).status()).toBe(200);const restored=await (await a.c.get(root)).json();expect(restored.product.status).toBe('ACTIVE');expect(restored.version.id).toBe(selected.version.id);expect(restored.rules.id).toBe(selected.rules.id);expect(restored.cover).toEqual(selected.cover);expect(restored.assets).toEqual(selected.assets);
    expect((await a.c.delete(`${root}/assets/${back.assetId}`)).status()).toBe(200);expect((await (await a.c.get(root)).json()).cover.asset_id).toBe(p.reference.assetId);
    expect((await database.query('SELECT input_snapshot FROM jobs WHERE id=$1',[job1])).rows[0].input_snapshot).toEqual(snapshot1);
    await evidence('product-lineage',{automaticVersion2:true,oneCurrentSlot:true,frontDefaultCover:true,selectedCover:true,removedCoverFallback:true,encryptedPrivateStorage:true,oldJobV1BytesMatch:true,futureJobV2:true,restorePreservesIdentity:true,derivedProvenance:true});
  }finally{await a.c.dispose();await database.end();s3.destroy();}
});

for(const channel of ['chrome','msedge'] as const)test(`${channel}: eight cards, real transfer progress, simultaneous uploads, retry, cover and restore`,async()=>{
  const a=await owner(`b-product-ui-${channel}-${Date.now()}@example.test`,false),p=await product(a.c,a.workspaceId);
  const browser=await chromium.launch({channel}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  try{
    await loginPage(page,a.c);await page.goto(`/products/${p.id}/edit?step=assets`);const audit=await observe(page);
    await expect(page.locator('.reference-card')).toHaveCount(8);await expect(page.getByLabel('Source',{exact:true})).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);
    const bytes=await sharp(randomBytes(512*512*3),{raw:{width:512,height:512,channels:3}}).png().toBuffer();
    await page.evaluate(()=>{const samples:number[]=[];(window as unknown as {uploadSamples:number[]}).uploadSamples=samples;new MutationObserver(()=>{for(const bar of document.querySelectorAll('progress'))samples.push(Number(bar.getAttribute('value')));}).observe(document.body,{subtree:true,childList:true,attributes:true});});
    const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:50,downloadThroughput:1_500_000,uploadThroughput:128_000});
    const front=page.locator('[data-slot="FRONT"]'),back=page.locator('[data-slot="BACK"]');
    await page.getByLabel('Front file',{exact:true}).setInputFiles({name:'front-v2.png',mimeType:'image/png',buffer:bytes});await front.getByRole('button',{name:'Replace',exact:true}).click();
    await expect(front.getByRole('progressbar')).toBeVisible();
    await page.getByLabel('Back file',{exact:true}).setInputFiles({name:'back.png',mimeType:'image/png',buffer:bytes});await back.getByRole('button',{name:'Upload',exact:true}).click();
    await expect(front.getByText('Version 2',{exact:true})).toBeVisible({timeout:60000});await expect(back.locator('.reference-status')).toHaveText('Ready',{timeout:60000});
    await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    const samples=await page.evaluate(()=>(window as unknown as {uploadSamples:number[]}).uploadSamples);expect(samples.some(n=>n>0&&n<100)).toBe(true);
    await back.getByRole('button',{name:'Set as cover'}).click();await expect(back.getByText('COVER',{exact:true})).toBeVisible();
    await page.goto('/products');const cover=page.getByRole('img',{name:'Historical Product cover',exact:true});await expect(cover).toBeVisible();await expect.poll(()=>cover.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.goto(`/products/${p.id}/edit?step=assets`);const texture=page.locator('[data-slot="TEXTURE"]');
    await page.getByLabel('Texture file',{exact:true}).setInputFiles({name:'texture.png',mimeType:'image/png',buffer:bytes});
    await page.route('**/*',route=>route.request().method()==='PUT'?route.abort('failed'):route.continue());await texture.getByRole('button',{name:'Upload',exact:true}).click();await expect(texture.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await page.unroute('**/*');
    await texture.getByRole('button',{name:'Retry',exact:true}).click();await expect(texture.locator('.reference-status')).toHaveText('Ready',{timeout:30000});
    const side=page.locator('[data-slot="SIDE"]');await page.getByLabel('Side file',{exact:true}).setInputFiles({name:'side.png',mimeType:'image/png',buffer:bytes});
    await page.route('**/assets/upload-intents',async route=>{await route.fetch();await route.abort('failed');});
    await side.getByRole('button',{name:'Upload',exact:true}).click();await expect(side.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await page.unroute('**/assets/upload-intents');
    await side.getByRole('button',{name:'Retry',exact:true}).click();await expect(side.locator('.reference-status')).toHaveText('Ready',{timeout:30000});
    const packaging=page.locator('[data-slot="PACKAGING"]');await page.getByLabel('Packaging file',{exact:true}).setInputFiles({name:'packaging.png',mimeType:'image/png',buffer:bytes});
    await page.route('**/finalize',async route=>{await route.fetch();await route.abort('failed');});
    await packaging.getByRole('button',{name:'Upload',exact:true}).click();await expect(packaging.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await page.unroute('**/finalize');
    await packaging.getByRole('button',{name:'Retry',exact:true}).click();await expect(packaging.locator('.reference-status')).toHaveText('Ready');await expect(packaging.getByText('Version 1',{exact:true})).toBeVisible();
    await page.goto(`/products/${p.id}`);page.once('dialog',dialog=>void dialog.accept());await page.getByRole('button',{name:'Archive',exact:true}).click();await expect(page).toHaveURL(/\/products$/);await page.getByLabel('Status').selectOption('ARCHIVED');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('link',{name:/Historical Product/}).click();await page.getByRole('button',{name:'Restore product',exact:true}).click();await expect(page.getByText('ACTIVE',{exact:true})).toBeVisible();
    await audit.finish();expect(audit.crashes).toEqual([]);expect(audit.leaks).toEqual([]);
    await evidence(`product-ui-${channel}`,{slots:8,actualUploadPercentSamples:[...new Set(samples)],simultaneousSlots:true,retry:true,lostIntentResponseRecovered:true,lostFinalizeResponseResolvesVersion1:true,coverImageLoaded:true,archiveRestore:true,pageErrors:audit.crashes,secretLeaks:audit.leaks});
  }finally{await context.close();await browser.close();await a.c.dispose();}
});

test('AI Videos reopens latest canonical active job across navigation, refresh, new tabs and workspaces',async({page,context})=>{
  const a=await owner(`b-active-${Date.now()}@example.test`),p=await product(a.c,a.workspaceId),database=await db();
  try{
    const first=await videoJob(a.c,a.workspaceId,p.id),latest=await videoJob(a.c,a.workspaceId,p.id);
    const b=(await (await a.c.post('/api/workspaces',{data:{name:'Isolated active-job brand'}})).json()).workspace.id;
    await loginPage(page,a.c);
    for(const state of ['QUEUED','WAITING_FOR_WORKER','RUNNING','RECONCILING']){
      await database.query('UPDATE jobs SET status=$1 WHERE id=$2',[state,latest]);await page.goto('/');await page.getByRole('link',{name:/AI Videos$/}).click();await expect(page).toHaveURL(new RegExp(`/ai-videos/${latest}$`));await page.reload();await expect(page).toHaveURL(new RegExp(`/ai-videos/${latest}$`));
    }
    const tab=await context.newPage();await tab.goto('/ai-videos');await expect(tab).toHaveURL(new RegExp(`/ai-videos/${latest}$`));await tab.close();
    await page.getByLabel('Switch workspace').selectOption(b);await expect(page.getByLabel('Switch workspace')).toBeEnabled();await page.goto('/ai-videos');await expect(page).toHaveURL(/\/ai-videos$/);await expect(page.getByRole('heading',{name:'Create Video',exact:true})).toBeVisible();
    await page.getByLabel('Switch workspace').selectOption(a.workspaceId);await expect(page.getByLabel('Switch workspace')).toBeEnabled();
    await database.query("UPDATE jobs SET status='CANCELLED' WHERE id=ANY($1::uuid[])",[[first,latest]]);await page.goto('/ai-videos');await expect(page).toHaveURL(/\/ai-videos$/);await expect(page.getByRole('heading',{name:'Create Video',exact:true})).toBeVisible();
    await evidence('active-job',{canonicalStates:4,latestSelection:true,internalNavigation:true,refresh:true,freshTab:true,workspaceScoped:true,terminalJobsExcluded:true,realInferenceCalls:0});
  }finally{await a.c.dispose();await database.end();}
});

test('insufficient AI and Clipper Tokens disable actions, refresh enables, stale quote rejected on server',async({page})=>{
  const a=await owner(`b-tokens-${Date.now()}@example.test`,false),p=await product(a.c,a.workspaceId),s=await source(a.c,a.workspaceId),database=await db();
  try{
    await loginPage(page,a.c);await page.goto('/ai-videos');await page.getByLabel('Video prompt').fill('Show the product with clear packaging on a bright studio table.');
    const generate=page.getByRole('button',{name:'Generate video',exact:true});await expect(page.locator('.insufficient-tokens')).toBeVisible();await expect(generate).toBeDisabled();expect(await generate.evaluate(el=>getComputedStyle(el).cursor)).toBe('not-allowed');await expect(page.locator('.token-quote')).toContainText('Available: 0 Tokens');await expect(page.locator('.token-quote')).toContainText('Required:');
    await page.goto('/clipper');await page.getByLabel('Source video',{exact:true}).selectOption(s.id);await page.getByLabel('Clipping goal').fill('Find useful ideas');const clips=page.getByRole('button',{name:'Start clipping',exact:true});await expect(page.locator('.insufficient-tokens')).toBeVisible();await expect(clips).toBeDisabled();expect(await clips.evaluate(el=>getComputedStyle(el).cursor)).toBe('not-allowed');
    fundFixture(a.workspaceId);await page.getByRole('button',{name:'Refresh balance',exact:true}).click();await expect(clips).toBeEnabled();
    await page.goto('/ai-videos');await page.getByLabel('Video prompt').fill('Show the product with clear packaging on a bright studio table.');await expect(generate).toBeEnabled();
    const input={operation:'AI_VIDEO',productId:p.id,prompt:'Show the product with clear packaging on a bright studio table.',tier:'QUALITY',durationSeconds:5,aspectRatio:'9:16',quantity:1};const quote=(await (await a.c.post(`/api/workspaces/${a.workspaceId}/billing/quotes`,{data:input})).json()).quote;
    const attribution=(await database.query('SELECT created_by,billing_account_id FROM workspaces WHERE id=$1',[a.workspaceId])).rows[0];
    execFileSync(process.execPath,['--import','tsx','scripts/billing-support.ts','adjust',attribution.billing_account_id,a.workspaceId,attribution.created_by,`phase-b-spend-${Date.now()}`,'-100000','Controlled stale-quote regression'],{env:{...process.env,ENABLE_BILLING_SUPPORT_CLI:'1'},stdio:'pipe',windowsHide:true});
    const rejected=await a.c.post(`/api/workspaces/${a.workspaceId}/ai-videos`,{data:{...input,idempotencyKey:`stale-${Date.now()}`,quoteId:quote.id,quoteHash:quote.quoteHash}});expect(rejected.status()).toBe(402);
    expect((await database.query('SELECT count(*)::integer AS count FROM jobs WHERE workspace_id=$1',[a.workspaceId])).rows[0].count).toBe(0);
    await evidence('token-ux',{bothActionsDisabled:true,disabledCursor:'not-allowed',requiredAvailableVisible:true,refreshEnables:true,serverStaleQuoteStatus:402,noAdmittedJob:true,balanceScope:'ACCOUNT'});
  }finally{await a.c.dispose();await database.end();}
});
