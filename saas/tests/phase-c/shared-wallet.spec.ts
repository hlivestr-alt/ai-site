import {test,expect,request,chromium,type APIRequestContext} from '@playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {owner,source,submit,dispatch,provision,worker,lease,type Claim} from '../clipper-helpers';
import {product,fixtureClips,publishJob} from '../content-helpers';
import {fundFixture,paidPost} from '../billing-helpers';
import {login,observe} from '../stabilization/browser-checks';
import {evidence} from '../stabilization/support';

async function database(){const d=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await d.connect();return d;}
async function shared(amount='10000'){
 const email=`phase-c-${randomUUID()}@example.test`,a=await owner(email,false);
 const r=await a.c.post('/api/workspaces',{data:{name:'Shared Brand B'}});expect(r.status()).toBe(201);
 const b=(await r.json()).workspace.id as string,c=await login(email);expect((await c.post(`/api/workspaces/${b}/select`)).status()).toBe(200);
 if(amount!=='0')fundFixture(a.workspaceId,amount);
 return {email,a:a.workspaceId,b,ca:a.c,cb:c,close:()=>Promise.all([a.c.dispose(),c.dispose()])};
}
async function wallet(c:APIRequestContext,w:string){const r=await c.get(`/api/workspaces/${w}/billing`);expect(r.status()).toBe(200);return (await r.json()).wallet;}
async function both(f:Awaited<ReturnType<typeof shared>>,available:string,reserved='0'){
 const [a,b]=await Promise.all([wallet(f.ca,f.a),wallet(f.cb,f.b)]);
 expect(a.billingAccountId).toBe(b.billingAccountId);for(const v of [a,b])expect(v).toMatchObject({availableTokens:available,reservedTokens:reserved});return a.billingAccountId as string;
}
const input=(productId:string,duration=4,extra:Record<string,unknown>={})=>({productId,prompt:'A controlled studio view of the saved Product, with a slow camera orbit.',tier:'QUALITY',durationSeconds:duration,aspectRatio:'1:1',quantity:1,idempotencyKey:randomUUID(),...extra});
async function ai(c:APIRequestContext,w:string,p:string,duration=4){const r=await paidPost(c,w,'AI_VIDEO',input(p,duration));expect(r.status()).toBe(201);return (await r.json()).job.id as string;}
function invoke(...args:string[]){return JSON.parse(execFileSync(process.execPath,['--env-file=.env.local','--import','tsx','tests/invoke-billing.ts',...args],{env:process.env,encoding:'utf8',windowsHide:true}));}
function support(args:Record<string,unknown>){return JSON.parse(execFileSync(process.execPath,['--env-file=.env.local','--import','tsx','tests/phase-c/invoke.ts',JSON.stringify(args)],{env:process.env,encoding:'utf8',windowsHide:true}));}
async function finish(d:pg.Client,id:string){
 for(let n=0;n<50;n++){await d.query('UPDATE provider_executions SET next_action_at=now() WHERE job_id=$1',[id]);await d.query('UPDATE job_outbox SET available_at=now() WHERE job_id=$1',[id]);await d.query('UPDATE jobs SET available_at=now() WHERE id=$1',[id]);dispatch();const s=(await d.query('SELECT status FROM jobs WHERE id=$1',[id])).rows[0].status;if(['SUCCEEDED','FAILED','CANCELLED'].includes(s)){dispatch();return s;}await new Promise(r=>setTimeout(r,150));}throw new Error('Controlled fake-provider job did not settle');
}
async function entries(d:pg.Client,id:string){return (await d.query('SELECT entry_type,count(*)::int AS count FROM token_ledger_entries WHERE job_id=$1 GROUP BY entry_type ORDER BY entry_type',[id])).rows;}
async function cancel(c:APIRequestContext,w:string,id:string){expect((await c.post(`/api/workspaces/${w}/jobs/${id}/cancel`)).status()).toBe(200);dispatch();invoke('settle',w,id);}

test('A: 10000 shared Tokens become 9440 after AI and 8840 after Clipper',async()=>{
 const f=await shared(),d=await database();try{
  const account=await both(f,'10000'),p=await product(f.ca,f.a),id=await ai(f.ca,f.a,p.id);
  await both(f,'9440','560');expect(await finish(d,id)).toBe('SUCCEEDED');await both(f,'9440');
  const s=await source(f.cb,f.b),r=await submit(f.cb,f.b,s.id,randomUUID(),{captions:false});expect(r.status()).toBe(201);const clip=(await r.json()).job.id;
  await both(f,'8840','600');await fixtureClips(f.cb,f.b,d,{jobId:clip,source:s});dispatch();invoke('settle',f.b,clip);await both(f,'8840');
  for(const job of [id,clip])expect(await entries(d,job)).toEqual([{entry_type:'CAPTURE',count:1},{entry_type:'RESERVE',count:1}]);
  expect((await d.query('SELECT count(DISTINCT billing_account_id)::int n FROM job_billing WHERE job_id=ANY($1::uuid[])',[ [id,clip] ])).rows[0].n).toBe(1);
  expect((await d.query('SELECT count(*)::int n FROM audit_events WHERE billing_account_id=$1 AND event_type IN(\'JOB_TOKENS_RESERVED\',\'JOB_TOKENS_CAPTURED\')',[account])).rows[0].n).toBe(4);
  await evidence('shared-spend',{status:'PASS',balances:[10000,9440,8840],aiTokens:560,clipperTokens:600,sameAccount:true,ledgerPerJob:{RESERVE:1,CAPTURE:1},auditAccountAndWorkspace:true});
 }finally{await f.close();await d.end();}
});
test('B: concurrent 700 admissions across brands serialize on the 1000 account wallet',async()=>{
 const f=await shared('1000'),d=await database();try{
  const pa=await product(f.ca,f.a),pb=await product(f.cb,f.b),a=input(pa.id,5),b=input(pb.id,5);
  const qs=await Promise.all([[f.ca,f.a,a],[f.cb,f.b,b]].map(async([c,w,v])=>(await (await (c as APIRequestContext).post(`/api/workspaces/${w}/billing/quotes`,{data:{...(v as object),operation:'AI_VIDEO'}})).json()).quote));
  const rs=await Promise.all([f.ca.post(`/api/workspaces/${f.a}/ai-videos`,{data:{...a,quoteId:qs[0].id,quoteHash:qs[0].quoteHash}}),f.cb.post(`/api/workspaces/${f.b}/ai-videos`,{data:{...b,quoteId:qs[1].id,quoteHash:qs[1].quoteHash}})]);
  expect(rs.map(r=>r.status()).sort()).toEqual([201,402]);await both(f,'300','700');
  expect((await d.query('SELECT count(*)::int n FROM job_billing WHERE workspace_id=ANY($1::uuid[])',[[f.a,f.b]])).rows[0].n).toBe(1);
  const winner=rs[0].status()===201?0:1,id=(await rs[winner].json()).job.id;await cancel(winner?f.cb:f.ca,winner?f.b:f.a,id);await both(f,'1000');
  await evidence('concurrency',{status:'PASS',startingAvailable:1000,requests:[700,700],statuses:[201,402],available:300,reserved:700,jobs:1,reservations:1,negativeBalances:0});
 }finally{await f.close();await d.end();}
});
test('C: definite Clipper failure releases 600 once into the shared account',async()=>{
 const f=await shared(),d=await database(),w=provision(`phase-c-failure-${Date.now()}`),c=await worker(w.credential);try{
  const s=await source(f.ca,f.a),r=await submit(f.ca,f.a,s.id,randomUUID(),{captions:false});expect(r.status()).toBe(201);const id=(await r.json()).job.id;await both(f,'9400','600');dispatch();
  const claim=(await (await c.post('/api/worker/claim',{data:{}})).json()).claim as Claim;expect(claim.jobId).toBe(id);
  expect((await c.post(`/api/worker/jobs/${id}/fail`,{data:{...lease(claim),errorCode:'SOURCE_INVALID',retriable:false,message:'Synthetic invalid source failure'}})).status()).toBe(200);
  for(let n=0;n<3;n++){dispatch();invoke('settle',f.a,id);}await both(f,'10000');expect(await entries(d,id)).toEqual([{entry_type:'RELEASE',count:1},{entry_type:'RESERVE',count:1}]);
  await evidence('failure-release',{status:'PASS',reserved:600,restoredAvailable:10000,reserves:1,releases:1,sharedAcrossBrands:true});
 }finally{await d.query("UPDATE workers SET status='DISABLED' WHERE id=$1",[w.workerId]);await c.dispose();await f.close();await d.end();}
});
test('D: lost worker lease retries under the original shared-account reservation',async()=>{
 const f=await shared(),d=await database(),w=provision(`phase-c-retry-${Date.now()}`),c=await worker(w.credential);try{
  const s=await source(f.cb,f.b),r=await submit(f.cb,f.b,s.id,randomUUID(),{captions:false});expect(r.status()).toBe(201);const id=(await r.json()).job.id;dispatch();
  const old=(await (await c.post('/api/worker/claim',{data:{}})).json()).claim as Claim;expect(old.jobId).toBe(id);
  await d.query("UPDATE worker_leases SET expires_at=now()-interval '1 second' WHERE id=$1",[old.leaseId]);dispatch();await both(f,'9400','600');
  expect((await c.post(`/api/worker/jobs/${id}/complete`,{data:{...lease(old),artifactIds:[]}})).status()).toBe(409);
  await d.query("UPDATE workers SET status='DISABLED' WHERE id=$1",[w.workerId]);await new Promise(r=>setTimeout(r,1200));dispatch();await fixtureClips(f.cb,f.b,d,{jobId:id,source:s});dispatch();invoke('settle',f.b,id);
  await both(f,'9400');expect((await d.query('SELECT status FROM job_attempts WHERE job_id=$1 ORDER BY attempt_number',[id])).rows.map(r=>r.status)).toEqual(['LOST','SUCCEEDED']);expect(await entries(d,id)).toEqual([{entry_type:'CAPTURE',count:1},{entry_type:'RESERVE',count:1}]);
  await evidence('shared-retry',{status:'PASS',tokens:600,attempts:['LOST','SUCCEEDED'],reserves:1,captures:1,available:9400,reserved:0});
 }finally{await d.query("UPDATE workers SET status='DISABLED' WHERE id=$1",[w.workerId]);await c.dispose();await f.close();await d.end();}
});
test('E: separate account 5000/800 switches and foreign quote/payment/ledger IDs are isolated',async()=>{
 const f=await shared('5000'),other=await owner(`phase-c-other-${randomUUID()}@example.test`,false),d=await database();try{
  fundFixture(other.workspaceId,'800');const uid=(await (await f.ca.get('/api/auth/session')).json()).user.id;await d.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'EDITOR')",[other.workspaceId,uid]);
  expect((await wallet(other.c,other.workspaceId)).billingAccountId).not.toBe((await wallet(f.ca,f.a)).billingAccountId);
  const p=await product(f.ca,f.a),v=input(p.id),q=(await (await f.ca.post(`/api/workspaces/${f.a}/billing/quotes`,{data:{...v,operation:'AI_VIDEO'}})).json()).quote;
  for(const [id,amount] of [[f.a,'5000'],[f.b,'5000'],[other.workspaceId,'800'],[f.a,'5000']]){expect((await f.ca.post(`/api/workspaces/${id}/select`)).status()).toBe(200);expect((await wallet(f.ca,id)).availableTokens).toBe(amount);}
  expect((await f.cb.post(`/api/workspaces/${f.b}/ai-videos`,{data:{...v,quoteId:q.id,quoteHash:q.quoteHash}})).status()).toBe(404);
  for(const suffix of ['','/ledger','/payments'])expect((await f.cb.get(`/api/workspaces/${other.workspaceId}/billing${suffix}`)).status()).toBe(404);
  expect((await f.ca.get(`/api/workspaces/${f.a}/products/${p.id}`)).status()).toBe(200);expect((await f.cb.get(`/api/workspaces/${f.b}/products/${p.id}`)).status()).toBe(404);
  const acct=(await wallet(f.ca,f.a)).billingAccountId,foreign=(await wallet(other.c,other.workspaceId)).billingAccountId;
  await expect(d.query('UPDATE workspaces SET billing_account_id=$1 WHERE id=$2',[foreign,f.a])).rejects.toThrow();
  await expect(d.query("INSERT INTO billing_quotes(id,workspace_id,billing_account_id,created_by,operation,price_version_id,request_hash,input_hash,input_snapshot,token_amount,quote_hash,expires_at) SELECT gen_random_uuid(),workspace_id,$1,created_by,operation,price_version_id,request_hash,input_hash,input_snapshot,token_amount,quote_hash,expires_at FROM billing_quotes WHERE id=$2",[foreign,q.id])).rejects.toThrow();
  expect(acct).not.toBe(foreign);await evidence('account-isolation',{status:'PASS',accountBalances:[5000,800],sameAccountSwitchUnchanged:true,crossAccountSwitchCorrect:true,foreignQuote:404,foreignBilling:404,immutableWorkspaceAccount:true,foreignQuoteAccountRejected:true});
 }finally{await f.close();await other.c.dispose();await d.end();}
});
test('F: fake verified payment from Brand B credits the account exactly once',async()=>{
 const f=await shared('0'),d=await database();try{
  const root=`/api/workspaces/${f.b}/billing`,catalog=(await (await f.cb.get(root+'/packages')).json()).packages,pack=catalog[0];
  const r=await f.cb.post(root+'/payments',{data:{packageVersionId:pack.id,idempotencyKey:randomUUID()}});expect(r.status()).toBe(201);const id=(await r.json()).payment.id;
  await both(f,'0');for(let n=0;n<3;n++)expect((await f.cb.post(root+`/payments/${id}/simulate`,{data:{status:'PAID'}})).status()).toBe(200);
  await both(f,String(pack.token_amount));expect((await d.query("SELECT count(*)::int n FROM token_ledger_entries WHERE payment_id=$1 AND entry_type='PURCHASE'",[id])).rows[0].n).toBe(1);
  const history=(await (await f.ca.get(`/api/workspaces/${f.a}/billing/payments`)).json()).payments;expect(history[0]).toMatchObject({id,workspaceId:f.b,workspaceName:'Shared Brand B',status:'PAID'});
  await evidence('purchase',{status:'PASS',provider:'fake',initiatingBrand:'B',purchasedTokens:Number(pack.token_amount),verifiedEvents:3,purchases:1,bothBrandsSameBalance:true,realCharges:0});
 }finally{await f.close();await d.end();}
});
test('G: explicit account refunds and adjustments are audited and idempotent',async()=>{
 const f=await shared(),d=await database();try{
  const p=await product(f.ca,f.a),id=await ai(f.ca,f.a,p.id);expect(await finish(d,id)).toBe('SUCCEEDED');await both(f,'9440');
  const billingAccountId=await both(f,'9440'),operatorId=(await (await f.ca.get('/api/auth/session')).json()).user.id,args={billingAccountId,workspaceId:f.a,operatorId,type:'REFUND',jobId:id,key:'phase-c-refund-once',reason:'Controlled Phase C captured job refund'};
  expect(support(args)).toEqual({status:200,existing:false});expect(support(args)).toEqual({status:200,existing:true});await both(f,'10000');expect(support({...args,key:'phase-c-second-refund'}).status).toBe(409);
  const adjust={billingAccountId,workspaceId:f.a,operatorId,type:'ADMIN_ADJUSTMENT',amount:'-40',key:'phase-c-adjustment-one',reason:'Controlled Phase C account adjustment'};expect(support(adjust).status).toBe(200);expect(support({...adjust,workspaceId:f.b}).status).toBe(409);await both(f,'9960');
  expect(support({...adjust,billingAccountId:randomUUID(),key:'phase-c-wrong-account'}).status).toBe(409);
  const rows=(await d.query("SELECT event_type,billing_account_id,workspace_id,actor_user_id,safe_metadata FROM audit_events WHERE billing_account_id=$1 AND event_type IN('TOKENS_REFUNDED','TOKENS_ADJUSTED')",[billingAccountId])).rows;expect(rows).toHaveLength(2);for(const row of rows){expect(row.workspace_id).toBe(f.a);expect(row.actor_user_id).toBe(operatorId);expect(row.safe_metadata.reason).toBeTruthy();}
  await evidence('refund-adjustment',{status:'PASS',refundTokens:560,refunds:1,replayIdempotent:true,secondRefundRejected:true,explicitWrongAccountRejected:true,crossBrandSupportKeyRejected:true,adjustment:-40,available:9960,operatorReasonAndBothIdentitiesAudited:true});
 }finally{await f.close();await d.end();}
});
test('H: new brand attaches to one existing wallet without funds or ledger duplication',async()=>{
 const f=await shared(),d=await database();try{
  const acct=await both(f,'10000'),before=(await d.query('SELECT count(*)::int n FROM token_ledger_entries WHERE billing_account_id=$1',[acct])).rows[0].n;
  const r=await f.cb.post('/api/workspaces',{data:{name:'Shared Brand C'}});expect(r.status()).toBe(201);const id=(await r.json()).workspace.id;expect((await f.cb.post(`/api/workspaces/${id}/select`)).status()).toBe(200);expect((await wallet(f.cb,id)).availableTokens).toBe('10000');
  expect((await d.query('SELECT count(*)::int n FROM billing_account_wallets WHERE billing_account_id=$1',[acct])).rows[0].n).toBe(1);expect((await d.query('SELECT count(*)::int n FROM token_ledger_entries WHERE billing_account_id=$1',[acct])).rows[0].n).toBe(before);
  await evidence('new-workspace',{status:'PASS',brands:3,wallets:1,available:10000,newTokenEntries:0});
 }finally{await f.close();await d.end();}
});
test('I: workspace admins spend but cannot manage billing or inspect sibling data; explicit manager grants only billing',async()=>{
 const f=await shared(),member=await owner(`phase-c-member-${randomUUID()}@example.test`,false),d=await database();try{
  const pa=await product(f.ca,f.a),pb=await product(f.cb,f.b),jb=await ai(f.cb,f.b,pb.id);expect(await finish(d,jb)).toBe('SUCCEEDED');const contents=publishJob(f.b,jb)[0],sb=await source(f.cb,f.b);
  const user=(await (await member.c.get('/api/auth/session')).json()).user.id;await d.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'ADMIN')",[f.a,user]);expect((await member.c.post(`/api/workspaces/${f.a}/select`)).status()).toBe(200);
  const w=await wallet(member.c,f.a);expect(w.canManage).toBe(false);expect((await member.c.get(`/api/workspaces/${f.a}/billing/payments`)).status()).toBe(403);expect((await member.c.post('/api/workspaces',{data:{name:'Unauthorized new sibling'}})).status()).toBe(403);
  const history=(await (await member.c.get(`/api/workspaces/${f.a}/billing/ledger`)).json());expect(history.scope).toBe('WORKSPACE');expect(history.entries.every((e:{workspace_id:string})=>e.workspace_id===f.a)).toBe(true);
  const restricted=[`products/${pb.id}`,`products/${pb.id}/assets/${pb.reference.assetId}/download?versionId=${pb.reference.versionId}`,`jobs/${jb}`,`sources/${sb.id}/download`,`content/${contents[0]}`];
  for(const path of restricted)expect((await member.c.get(`/api/workspaces/${f.a}/${path}`)).status()).toBe(404);
  expect((await member.c.get(`/api/workspaces/${f.b}/products`)).status()).toBe(404);
  const ja=await ai(member.c,f.a,pa.id);await cancel(member.c,f.a,ja);
  await d.query("INSERT INTO billing_account_members(billing_account_id,user_id,role) VALUES($1,$2,'MANAGER')",[w.billingAccountId,user]);
  expect((await wallet(member.c,f.a)).canManage).toBe(true);const managed=(await (await member.c.get(`/api/workspaces/${f.a}/billing/ledger`)).json());expect(managed.scope).toBe('ACCOUNT');expect(managed.entries.some((e:{workspace_id:string;can_open_job:boolean;workspace_name:string})=>e.workspace_id===f.b&&!e.can_open_job&&e.workspace_name==='Shared Brand B')).toBe(true);
  expect((await member.c.get(`/api/workspaces/${f.a}/billing/payments`)).status()).toBe(200);const listed=(await (await member.c.get('/api/workspaces')).json()).workspaces;expect(listed.some((v:{id:string})=>v.id===f.b)).toBe(false);for(const path of restricted)expect((await member.c.get(`/api/workspaces/${f.a}/${path}`)).status()).toBe(404);
  await evidence('team-privacy',{status:'PASS',workspaceAdminCanSpend:true,implicitBillingAdmin:false,ordinaryHistory:'WORKSPACE',explicitManagerHistory:'ACCOUNT',brandLabels:true,siblingJobLinks:false,siblingDataStatuses:restricted.map(()=>404),managerDoesNotGrantWorkspaceAccess:true});
 }finally{await f.close();await member.c.dispose();await d.end();}
});
test('account reconciliation matches all workspace reservations and ledger sums',async()=>{
 const f=await shared(),d=await database();try{const p=await product(f.ca,f.a),id=await ai(f.ca,f.a,p.id);await both(f,'9440','560');const report=invoke('report');for(const code of ['WALLET_LEDGER_MISMATCH','RESERVED_JOB_MISMATCH','LEDGER_ACCOUNT_MISMATCH','QUOTE_ACCOUNT_MISMATCH','PAYMENT_ACCOUNT_MISMATCH','REFUND_MISMATCH'])expect(report[code]).toEqual([]);await cancel(f.ca,f.a,id);await evidence('reconciliation',{status:'PASS',availableMatchesLedger:true,reservedMatchesLedger:true,reservedJobsAcrossBrands:true,accountReferenceMismatches:0});}finally{await f.close();await d.end();}
});
test('concurrent initial onboarding creates one zero-funded account and wallet atomically',async()=>{
 const c=await request.newContext({baseURL:process.env.SAAS_TEST_BASE_URL,extraHTTPHeaders:{Origin:process.env.SAAS_TEST_BASE_URL!}}),d=await database(),email=`phase-c-onboarding-${randomUUID()}@example.test`;try{
  expect((await c.post('/api/auth/register',{data:{email,displayName:'Controlled onboarding QA',password:'ValidPassword123!'}})).status()).toBe(201);
  let token:string|null=null;for(let n=0;n<50&&!token;n++){for(const f of (await readdir('data/mailbox')).filter(f=>f.endsWith('.json'))){const m=JSON.parse(await readFile(`data/mailbox/${f}`,'utf8'));if(m.to===email&&m.subject==='Verify your account'){token=new URL(m.url).searchParams.get('token');break;}}if(!token)await new Promise(r=>setTimeout(r,100));}if(!token)throw new Error('Owned onboarding fixture mail was not delivered');
  expect((await c.post('/api/auth/verify',{data:{token}})).status()).toBe(200);token=null;
  const rs=await Promise.all(Array.from({length:10},(_,n)=>c.post('/api/workspaces',{data:{name:`Concurrent initial brand ${n}`}})));for(const r of rs)expect(r.status()).toBe(201);
  const user=(await (await c.get('/api/auth/session')).json()).user.id,accounts=(await d.query('SELECT id FROM billing_accounts WHERE created_by=$1',[user])).rows;expect(accounts).toHaveLength(1);
  expect((await d.query('SELECT count(*)::int n FROM workspaces WHERE billing_account_id=$1',[accounts[0].id])).rows[0].n).toBe(10);expect((await d.query('SELECT available_tokens,reserved_tokens FROM billing_account_wallets WHERE billing_account_id=$1',[accounts[0].id])).rows).toEqual([{available_tokens:'0',reserved_tokens:'0'}]);expect((await d.query('SELECT count(*)::int n FROM token_ledger_entries WHERE billing_account_id=$1',[accounts[0].id])).rows[0].n).toBe(0);
  await evidence('onboarding',{status:'PASS',simultaneousInitialWorkspaceRequests:10,accounts:1,wallets:1,workspaces:10,available:0,reserved:0,tokenEntries:0});
 }finally{await c.dispose();await d.end();}
});
for(const channel of ['chrome','msedge'] as const)test(`${channel}: shared billing, repeated switching, new brand, separate account and both quote refresh states`,async()=>{
 test.setTimeout(240000);const f=await shared('1000'),other=await owner(`phase-c-ui-other-${randomUUID()}@example.test`,false),d=await database(),browser=await chromium.launch({channel}),context=await browser.newContext(),page=await context.newPage();try{
  fundFixture(other.workspaceId,'800');const uid=(await (await f.ca.get('/api/auth/session')).json()).user.id;await d.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'EDITOR')",[other.workspaceId,uid]);await product(f.ca,f.a);await product(f.cb,f.b);const pb=(await (await f.cb.get(`/api/workspaces/${f.b}/products?status=ACTIVE`)).json()).products[0];const s=await source(f.cb,f.b);
  const browserSession=await login(f.email);await context.addCookies((await browserSession.storageState()).cookies);await browserSession.dispose();const audit=await observe(page);await page.goto('/billing');await expect(page.getByText('ACCOUNT BALANCE',{exact:true})).toBeVisible();await expect(page.getByText(/Shared across your workspaces/)).toBeVisible();
  for(const id of [f.b,f.a,f.b,f.a]){await page.getByLabel('Switch workspace').selectOption(id);await expect(page.getByLabel('Switch workspace')).toBeEnabled();await page.getByRole('link',{name:/Billing$/}).click();await expect(page.locator('.stat-card').first().locator('strong')).toHaveText('1,000');}
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();await page.getByLabel('Workspace name').fill(`Browser Shared C ${channel}`);await page.locator('.workspace-create').getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('select[aria-label="Switch workspace"] option:checked')).toHaveText(`Browser Shared C ${channel}`);await page.getByRole('link',{name:/Billing$/}).click();await expect(page.locator('.stat-card').first().locator('strong')).toHaveText('1,000');
  await page.getByLabel('Switch workspace').selectOption(other.workspaceId);await expect(page.getByLabel('Switch workspace')).toBeEnabled();await page.getByRole('link',{name:/Billing$/}).click();await expect(page.locator('.stat-card').first().locator('strong')).toHaveText('800');
  await page.getByLabel('Switch workspace').selectOption(f.b);await expect(page.getByLabel('Switch workspace')).toBeEnabled();await page.goto('/ai-videos');await page.getByLabel('Video prompt').fill(input(pb.id).prompt);await page.getByLabel('Duration',{exact:true}).selectOption('4');await expect(page.getByText('Available: 1,000 Tokens',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Generate video',exact:true})).toBeEnabled();
  const pa=(await (await f.ca.get(`/api/workspaces/${f.a}/products?status=ACTIVE`)).json()).products[0],id=await ai(f.ca,f.a,pa.id);await page.getByRole('button',{name:'Refresh balance',exact:true}).click();await expect(page.getByText('Available: 440 Tokens',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Generate video',exact:true})).toBeDisabled();
  await page.goto('/clipper');await page.getByLabel('Source video',{exact:true}).selectOption(s.id);await page.getByLabel('Number of clips',{exact:true}).fill('2');await page.getByLabel('Captions',{exact:true}).uncheck();await expect(page.getByText('Required: 600 Tokens',{exact:true})).toBeVisible();await expect(page.getByText('Available: 440 Tokens',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Start clipping',exact:true})).toBeDisabled();
  await cancel(f.ca,f.a,id);await page.getByRole('button',{name:'Refresh balance',exact:true}).click();await expect(page.getByText('Available: 1,000 Tokens',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Start clipping',exact:true})).toBeEnabled();await audit.finish();expect(audit.crashes).toEqual([]);expect(audit.leaks).toEqual([]);
  await evidence(`shared-ui-${channel}`,{status:'PASS',browserVersion:browser.version(),repeatedSwitches:4,accountBalanceLabel:true,brandCreationUsesSameBalance:true,sharedBalance:1000,separateAccountBalance:800,aiQuote:560,clipperQuote:600,afterSiblingReserve:440,insufficientButtonsDisabled:true,refreshAfterRelease:true,pageErrors:audit.crashes,secretLeaks:audit.leaks});
 }finally{await context.close();await browser.close();await f.close();await other.c.dispose();await d.end();}
});
