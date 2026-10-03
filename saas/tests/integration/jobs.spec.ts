import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import sharp from "sharp";

const base=(process.env.SAAS_TEST_BASE_URL||"http://127.0.0.1:3200"),password="ValidPassword123!";
async function mail(to:string,subject:string){for(let attempt=0;attempt<50;attempt++){const folder=join(process.cwd(),"data","mailbox"),files=(await readdir(folder).catch(()=>[])).filter(x=>x.endsWith(".json")).sort().reverse();for(const file of files){const item=JSON.parse(await readFile(join(folder,file),"utf8"));if(item.to===to&&item.subject.includes(subject))return item.url as string;}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error("Local development mail missing");}
async function owner(email:string){const c=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base,"x-diagnostic-token":process.env.DEV_DIAGNOSTIC_TOKEN||""}});expect((await c.post("/api/auth/register",{data:{email,displayName:"Jobs Owner",password}})).status()).toBe(201);const token=new URL(await mail(email,"Verify")).searchParams.get("token");expect((await c.post("/api/auth/verify",{data:{token}})).status()).toBe(200);const w=await c.post("/api/workspaces",{data:{name:`Jobs ${Date.now()}`}});expect(w.status()).toBe(201);return {c,workspaceId:(await w.json()).workspace.id as string};}
function provision(name:string,max=1,capability="SYSTEM_TEST"){const result=execFileSync(process.execPath,["--env-file=.env.local","scripts/worker-admin.mjs","create",name,capability,String(max),"--test"],{cwd:process.cwd(),encoding:"utf8"});return JSON.parse(result) as {workerId:string;credential:string};}
async function worker(credential:string){return request.newContext({baseURL:base,extraHTTPHeaders:{Authorization:`Bearer ${credential}`}});}
async function heartbeat(c:APIRequestContext,slots=1){const r=await c.post("/api/worker/heartbeat",{data:{agentVersion:"test-1",pipelineVersion:"fixture",availableSlots:slots,activeLeaseIds:[]}});expect(r.status(),await r.text()).toBe(200);}
function dispatch(){execFileSync(process.execPath,["--env-file=.env.local","--import","tsx","scripts/dispatcher.ts","--once"],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,OBJECT_STORAGE_BUCKET:process.env.TEST_OBJECT_STORAGE_BUCKET,JOB_RETRY_BASE_MS:"1000"},stdio:"pipe"});}
async function fixture(c:APIRequestContext,workspaceId:string,key:string,extra:Record<string,unknown>={}){return c.post("/api/dev/fixture-jobs",{data:{workspaceId,idempotencyKey:key,steps:3,delayMs:20,...extra}});}
type Claim={jobId:string;attemptId:string;attemptNumber:number;leaseId:string;fencingToken:string;inputSnapshot:{fixture:{steps:number}}};
const lease=(claim:Claim)=>({attemptId:claim.attemptId,leaseId:claim.leaseId,fencingToken:claim.fencingToken});
async function finish(c:APIRequestContext,claim:Claim){return c.post(`/api/worker/jobs/${claim.jobId}/complete`,{data:{...lease(claim),digest:createHash("sha256").update(`SYSTEM_TEST:${claim.jobId}:${claim.inputSnapshot.fixture.steps}`).digest("hex"),artifactIds:[]}});}

test("durable fixture jobs, idempotency, claims, fencing and isolation",async()=>{
  test.setTimeout(120_000);
  const stamp=Date.now(),capability=`SYSTEM_TEST_${stamp}`,a=await owner(`p3-a-${stamp}@example.test`),b=await owner(`p3-b-${stamp}@example.test`),w1=provision(`p3-w1-${stamp}`,1,capability),w2=provision(`p3-w2-${stamp}`,1,capability),c1=await worker(w1.credential),c2=await worker(w2.credential);
  const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
  try{
    await heartbeat(c1);await heartbeat(c2);
    const key=`p3-basic-${stamp}`,first=await fixture(a.c,a.workspaceId,key,{capability});expect(first.status(),await first.text()).toBe(201);
    const jobId=(await first.json()).job.id as string;
    const same=await fixture(a.c,a.workspaceId,key,{capability});expect(same.status()).toBe(200);expect((await same.json()).job.id).toBe(jobId);
    expect((await fixture(a.c,a.workspaceId,key,{steps:4,capability})).status()).toBe(409);
    const before=await db.query("SELECT status FROM jobs WHERE id=$1",[jobId]);expect(before.rows[0].status).toBe("QUEUED");
    expect((await db.query("SELECT count(*) AS n FROM job_outbox WHERE job_id=$1",[jobId])).rows[0].n).toBe("1");
    dispatch();dispatch();
    const claims=await Promise.all([c1.post("/api/worker/claim",{data:{}}),c2.post("/api/worker/claim",{data:{}})]);
    const values=await Promise.all(claims.map(x=>x.json()));
    expect(values.filter(x=>x.claim)).toHaveLength(1);
    const winning=values[0].claim?c1:c2,claim=values.find(x=>x.claim).claim as Claim;
    expect(claim.jobId).toBe(jobId);
    const p=await winning.post(`/api/worker/jobs/${jobId}/progress`,{data:{...lease(claim),sequence:1,percent:30,stage:"STEP",message:"Step 1"}});expect(p.status()).toBe(200);
    const duplicate=await winning.post(`/api/worker/jobs/${jobId}/progress`,{data:{...lease(claim),sequence:1,percent:20,stage:"STEP",message:"Duplicate"}});expect((await duplicate.json()).duplicate).toBe(true);
    expect((await winning.post(`/api/worker/jobs/${jobId}/progress`,{data:{...lease(claim),sequence:2,percent:10,stage:"STEP",message:"Backwards"}})).status()).toBe(409);
    expect((await b.c.get(`/api/workspaces/${a.workspaceId}/jobs/${jobId}`)).status()).toBe(404);
    expect((await b.c.get(`/api/workspaces/${b.workspaceId}/jobs/${jobId}`)).status()).toBe(404);
    expect((await b.c.post(`/api/workspaces/${a.workspaceId}/jobs/${jobId}/cancel`)).status()).toBe(404);
    expect((await b.c.get(`/api/workspaces/${b.workspaceId}/jobs`)).json()).resolves.toMatchObject({total:0});
    const foreign=await fixture(b.c,b.workspaceId,`p3-foreign-${stamp}`,{capability}),foreignId=(await foreign.json()).job.id as string;expect(foreign.status()).toBe(201);
    expect((await winning.post(`/api/worker/jobs/${foreignId}/assets/download`,{data:{...lease(claim),assetVersionId:claim.attemptId}})).status()).toBe(409);
    expect((await winning.post(`/api/worker/jobs/${foreignId}/outputs`,{data:{...lease(claim),slotName:"foreign",mimeType:"application/json",byteSize:1}})).status()).toBe(409);
    expect((await b.c.post(`/api/workspaces/${b.workspaceId}/jobs/${foreignId}/cancel`)).status()).toBe(200);
    const completed=await finish(winning,claim);expect(completed.status(),await completed.text()).toBe(200);
    const again=await finish(winning,claim);expect(again.status()).toBe(200);expect((await again.json()).duplicate).toBe(true);
    expect((await db.query("SELECT status,attempt_count FROM jobs WHERE id=$1",[jobId])).rows[0]).toMatchObject({status:"SUCCEEDED",attempt_count:1});
    const other=await fixture(a.c,a.workspaceId,`p3-expire-${stamp}`,{capability});const expiredId=(await other.json()).job.id as string;dispatch();
    await heartbeat(c1);const oldClaim=(await (await c1.post("/api/worker/claim",{data:{}})).json()).claim as Claim;expect(oldClaim.jobId).toBe(expiredId);
    await db.query("UPDATE worker_leases SET expires_at=now()-interval '1 second' WHERE id=$1",[oldClaim.leaseId]);dispatch();
    expect((await finish(c1,oldClaim)).status()).toBe(409);
    await new Promise(resolve=>setTimeout(resolve,1200));dispatch();await heartbeat(c2);
    const newClaim=(await (await c2.post("/api/worker/claim",{data:{}})).json()).claim as Claim;expect(newClaim.jobId).toBe(expiredId);expect(newClaim.attemptId).not.toBe(oldClaim.attemptId);
    expect((await finish(c1,oldClaim)).status()).toBe(409);
    expect((await finish(c2,newClaim)).status()).toBe(200);
    const history=await db.query("SELECT attempt_number,status FROM job_attempts WHERE job_id=$1 ORDER BY attempt_number",[expiredId]);expect(history.rows).toMatchObject([{attempt_number:1,status:"LOST"},{attempt_number:2,status:"SUCCEEDED"}]);
  } finally {await Promise.all([a.c.dispose(),b.c.dispose(),c1.dispose(),c2.dispose()]);await db.end();}
});

test("Product snapshots stay frozen and worker media/output access follows the current lease",async()=>{
  test.setTimeout(120_000);
  const stamp=Date.now(),capability=`SYSTEM_TEST_${stamp}`,a=await owner(`p3-media-${stamp}@example.test`),w=provision(`p3-media-worker-${stamp}`,1,capability),c=await worker(w.credential);
  const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
  try{
    const productResponse=await a.c.post(`/api/workspaces/${a.workspaceId}/products`,{data:{brand:"Test Brand",name:"Snapshot Cream",category:"Care",sku:`SNAP-${stamp}`,description:"Version one",keySellingPoints:["Benefit"],targetAudience:"Adults"}});
    expect(productResponse.status(),await productResponse.text()).toBe(201);
    const productId=(await productResponse.json()).product.id as string;
    const png=await sharp({create:{width:80,height:80,channels:3,background:"#afc4de"}}).png().toBuffer();
    const upload=await a.c.post(`/api/workspaces/${a.workspaceId}/products/${productId}/assets/upload-intents`,{data:{purpose:"FRONT",mimeType:"image/png",byteSize:png.length,filename:"snapshot.png",sha256:createHash("sha256").update(png).digest("hex"),sourceType:"CUSTOMER_OWNED",permissionConfirmed:true,permissionNote:"Fixture"}});
    expect(upload.status(),await upload.text()).toBe(201);
    const firstAsset=(await upload.json()).intent as {assetId:string;versionId:string;uploadUrl:string;requiredHeaders:Record<string,string>};
    expect((await fetch(firstAsset.uploadUrl,{method:"PUT",headers:firstAsset.requiredHeaders,body:new Uint8Array(png)})).status).toBe(200);
    expect((await a.c.post(`/api/workspaces/${a.workspaceId}/products/${productId}/assets/${firstAsset.assetId}/versions/${firstAsset.versionId}/finalize`)).status()).toBe(200);
    expect((await a.c.post(`/api/workspaces/${a.workspaceId}/products/${productId}/activate`)).status()).toBe(200);
    const first=await fixture(a.c,a.workspaceId,`snapshot-one-${stamp}`,{productId,capability}),firstId=(await first.json()).job.id as string;expect(first.status()).toBe(201);
    const firstRow=(await db.query<{input_snapshot:{product:{versionId:string;ruleVersionId:string;assets:{assetVersionId:string}[]}}}>("SELECT input_snapshot FROM jobs WHERE id=$1",[firstId])).rows[0];
    expect(firstRow.input_snapshot.product.assets[0].assetVersionId).toBe(firstAsset.versionId);
    const edit=await a.c.patch(`/api/workspaces/${a.workspaceId}/products/${productId}`,{data:{brand:"Test Brand",name:"Snapshot Cream",category:"Care",sku:`SNAP-${stamp}`,description:"Version two",keySellingPoints:["Benefit"],targetAudience:"Adults"}});expect(edit.status(),await edit.text()).toBe(200);
    expect((await a.c.patch(`/api/workspaces/${a.workspaceId}/products/${productId}/rules`,{data:{keepLogo:false,keepPackagingText:true,keepProductShape:true,keepCapPump:true,keepProductColorMaterial:true,keepApplicationMethod:true,customInstructions:"Updated rules"}})).status()).toBe(200);
    const replacement=await a.c.post(`/api/workspaces/${a.workspaceId}/products/${productId}/assets/${firstAsset.assetId}/upload-intents`,{data:{purpose:"FRONT",mimeType:"image/png",byteSize:png.length,filename:"replacement.png",sha256:createHash("sha256").update(png).digest("hex"),sourceType:"CUSTOMER_OWNED",permissionConfirmed:true,permissionNote:"Fixture"}});expect(replacement.status(),await replacement.text()).toBe(201);
    const secondAsset=(await replacement.json()).intent as typeof firstAsset;
    expect((await fetch(secondAsset.uploadUrl,{method:"PUT",headers:secondAsset.requiredHeaders,body:new Uint8Array(png)})).status).toBe(200);
    expect((await a.c.post(`/api/workspaces/${a.workspaceId}/products/${productId}/assets/${secondAsset.assetId}/versions/${secondAsset.versionId}/finalize`)).status()).toBe(200);
    const second=await fixture(a.c,a.workspaceId,`snapshot-two-${stamp}`,{productId,capability}),secondId=(await second.json()).job.id as string;expect(second.status()).toBe(201);
    const rows=await db.query<{id:string;input_snapshot:{product:{versionId:string;ruleVersionId:string;assets:{assetVersionId:string}[]}}}>("SELECT id,input_snapshot FROM jobs WHERE id=ANY($1::uuid[])",[[firstId,secondId]]);
    const old=rows.rows.find(x=>x.id===firstId)!.input_snapshot.product,newer=rows.rows.find(x=>x.id===secondId)!.input_snapshot.product;
    expect(old.versionId).toBe(firstRow.input_snapshot.product.versionId);expect(old.ruleVersionId).toBe(firstRow.input_snapshot.product.ruleVersionId);expect(old.assets[0].assetVersionId).toBe(firstAsset.versionId);
    expect(newer.versionId).not.toBe(old.versionId);expect(newer.ruleVersionId).not.toBe(old.ruleVersionId);expect(newer.assets[0].assetVersionId).toBe(secondAsset.versionId);
    dispatch();await heartbeat(c);
    const claim=(await (await c.post("/api/worker/claim",{data:{}})).json()).claim as Claim;expect(claim.jobId).toBe(firstId);
    const media=await c.post(`/api/worker/jobs/${firstId}/assets/download`,{data:{...lease(claim),assetVersionId:firstAsset.versionId}});expect(media.status(),await media.text()).toBe(200);expect((await fetch((await media.json()).url)).status).toBe(200);
    expect((await c.post(`/api/worker/jobs/${firstId}/assets/download`,{data:{...lease(claim),assetVersionId:secondAsset.versionId}})).status()).toBe(404);
    expect((await c.post(`/api/worker/jobs/${firstId}/assets/download`,{data:{...lease(claim),assetVersionId:firstAsset.versionId,storageKey:"other/workspace/object"}})).status()).toBe(400);
    const bytes=Buffer.from(JSON.stringify({fixture:true})),sha=createHash("sha256").update(bytes).digest("hex");
    expect((await c.post(`/api/worker/jobs/${firstId}/outputs`,{data:{...lease(claim),slotName:"receipt",mimeType:"application/json",byteSize:bytes.length,sha256:sha,storageKey:"arbitrary"}})).status()).toBe(400);
    const slot=await c.post(`/api/worker/jobs/${firstId}/outputs`,{data:{...lease(claim),slotName:"receipt",mimeType:"application/json",byteSize:bytes.length,sha256:sha}});expect(slot.status(),await slot.text()).toBe(200);
    const output=(await slot.json()) as {artifactId:string;uploadUrl:string;requiredHeaders:Record<string,string>};
    expect((await fetch(output.uploadUrl,{method:"PUT",headers:output.requiredHeaders,body:new Uint8Array(bytes)})).status).toBe(200);
    expect((await finish(c,claim)).status()).toBe(409);
    const done=await c.post(`/api/worker/jobs/${firstId}/complete`,{data:{...lease(claim),digest:createHash("sha256").update(`SYSTEM_TEST:${firstId}:3`).digest("hex"),artifactIds:[output.artifactId]}});expect(done.status(),await done.text()).toBe(200);
    await heartbeat(c);const claim2=(await (await c.post("/api/worker/claim",{data:{}})).json()).claim as Claim;expect(claim2.jobId).toBe(secondId);
    expect((await c.post(`/api/worker/jobs/${secondId}/assets/download`,{data:{...lease(claim2),assetVersionId:firstAsset.versionId}})).status()).toBe(404);
    expect((await c.post(`/api/worker/jobs/${secondId}/complete`,{data:{...lease(claim2),digest:createHash("sha256").update(`SYSTEM_TEST:${secondId}:3`).digest("hex"),artifactIds:[output.artifactId]}})).status()).toBe(409);
    expect((await finish(c,claim2)).status()).toBe(200);
  }finally{await Promise.all([a.c.dispose(),c.dispose()]);await db.end();}
});

test("worker rotation, drain, cancellation and bounded retry",async()=>{
  test.setTimeout(120_000);
  const stamp=Date.now(),capability=`SYSTEM_TEST_${stamp}`,a=await owner(`p3-ops-${stamp}@example.test`),provisioned=provision(`p3-ops-worker-${stamp}`,1,capability),old=await worker(provisioned.credential);
  const admin=(...args:string[])=>JSON.parse(execFileSync(process.execPath,["--env-file=.env.local","scripts/worker-admin.mjs",...args,"--test"],{cwd:process.cwd(),encoding:"utf8"}));
  const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();let current:APIRequestContext|undefined;
  try{
    await heartbeat(old);
    const credentialRow=(await db.query<{token_hash:string}>("SELECT token_hash FROM worker_credentials WHERE worker_id=$1 AND revoked_at IS NULL",[provisioned.workerId])).rows[0];
    expect(credentialRow.token_hash).toMatch(/^[a-f0-9]{64}$/);expect(credentialRow.token_hash).not.toContain(provisioned.credential);
    const rotated=admin("rotate",provisioned.workerId);current=await worker(rotated.credential);
    expect((await old.post("/api/worker/heartbeat",{data:{agentVersion:"old",availableSlots:1}})).status()).toBe(401);
    await heartbeat(current);
    admin("drain",provisioned.workerId);
    expect((await (await current.post("/api/worker/claim",{data:{}})).json()).reason).toBe("not_active");
    admin("activate",provisioned.workerId);
    await db.query("UPDATE workers SET last_heartbeat_at=now()-interval '91 seconds' WHERE id=$1",[provisioned.workerId]);
    expect((await (await current.post("/api/worker/claim",{data:{}})).json()).reason).toBe("heartbeat_stale");
    await heartbeat(current);
    const first=await fixture(a.c,a.workspaceId,`cancel-running-${stamp}`,{capability}),firstId=(await first.json()).job.id as string;dispatch();await heartbeat(current);
    const claim=(await (await current.post("/api/worker/claim",{data:{}})).json()).claim as Claim;expect(claim.jobId).toBe(firstId);
    const cancellation=await a.c.post(`/api/workspaces/${a.workspaceId}/jobs/${firstId}/cancel`);expect(cancellation.status()).toBe(200);
    const renewed=await current.post(`/api/worker/jobs/${firstId}/renew`,{data:lease(claim)});expect((await renewed.json()).cancelRequested).toBe(true);
    expect((await finish(current,claim)).status()).toBe(409);
    const failed=await current.post(`/api/worker/jobs/${firstId}/fail`,{data:{...lease(claim),errorCode:"CANCELLED",retriable:false,message:"Cancelled"}});expect((await failed.json()).status).toBe("CANCELLED");
    const queued=await fixture(a.c,a.workspaceId,`cancel-queued-${stamp}`,{capability}),queuedId=(await queued.json()).job.id as string;
    expect((await a.c.post(`/api/workspaces/${a.workspaceId}/jobs/${queuedId}/cancel`)).status()).toBe(200);dispatch();
    expect((await db.query("SELECT status FROM jobs WHERE id=$1",[queuedId])).rows[0].status).toBe("CANCELLED");
    const retry=await fixture(a.c,a.workspaceId,`retry-max-${stamp}`,{capability}),retryId=(await retry.json()).job.id as string;
    for(let attempt=1;attempt<=3;attempt++){
      if(attempt>1){const available=(await db.query<{available_at:Date}>("SELECT available_at FROM jobs WHERE id=$1",[retryId])).rows[0].available_at;await new Promise(resolve=>setTimeout(resolve,Math.max(0,available.getTime()-Date.now()+200)));}
      dispatch();await heartbeat(current);
      const active=(await (await current.post("/api/worker/claim",{data:{}})).json()).claim as Claim;expect(active.jobId).toBe(retryId);expect(active.attemptNumber).toBe(attempt);
      const response=await current.post(`/api/worker/jobs/${retryId}/fail`,{data:{...lease(active),errorCode:"FIXTURE_ERROR",retriable:true,message:"Safe fixture failure"}});expect(response.status(),await response.text()).toBe(200);
    }
    expect((await db.query("SELECT status,attempt_count FROM jobs WHERE id=$1",[retryId])).rows[0]).toMatchObject({status:"FAILED",attempt_count:3});
    expect((await db.query("SELECT count(*) AS n FROM job_attempts WHERE job_id=$1",[retryId])).rows[0].n).toBe("3");
    admin("revoke",provisioned.workerId);
    expect((await current.post("/api/worker/heartbeat",{data:{agentVersion:"revoked",availableSlots:1}})).status()).toBe(401);
  }finally{await Promise.all([a.c.dispose(),old.dispose(),current?.dispose()]);await db.end();}
});
