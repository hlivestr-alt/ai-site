import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import pg from "pg";

const base="http://127.0.0.1:3200",password="ValidPassword123!",run=promisify(execFile);
const dispatcherArgs=["--env-file=.env.local","--import","tsx","scripts/dispatcher.ts","--once"];
function dispatcherEnv(){return {...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,OBJECT_STORAGE_BUCKET:process.env.TEST_OBJECT_STORAGE_BUCKET,APP_ENV:"local",VIDEO_PROVIDER:"fake",ENABLE_FAKE_VIDEO_PROVIDER:"1"};}
function tick(){execFileSync(process.execPath,dispatcherArgs,{cwd:process.cwd(),env:dispatcherEnv(),stdio:"pipe",timeout:30000});}
async function concurrentTicks(){await Promise.all([run(process.execPath,dispatcherArgs,{cwd:process.cwd(),env:dispatcherEnv(),timeout:30000}),run(process.execPath,dispatcherArgs,{cwd:process.cwd(),env:dispatcherEnv(),timeout:30000})]);}
async function mail(to:string){for(let i=0;i<50;i++){const dir=join(process.cwd(),"data","mailbox"),files=(await readdir(dir).catch(()=>[])).filter(x=>x.endsWith(".json")).sort().reverse();for(const name of files){const item=JSON.parse(await readFile(join(dir,name),"utf8"));if(item.to===to&&item.subject.includes("Verify"))return item.url as string;}await new Promise(r=>setTimeout(r,100));}throw new Error("Verification mail missing");}
async function account(tag:string){const c=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base,"x-diagnostic-token":process.env.DEV_DIAGNOSTIC_TOKEN||""}}),email=`p4-${tag}-${Date.now()}@example.test`;
  expect((await c.post("/api/auth/register",{data:{email,displayName:"Video Owner",password}})).status()).toBe(201);
  const token=new URL(await mail(email)).searchParams.get("token");expect((await c.post("/api/auth/verify",{data:{token}})).status()).toBe(200);
  const response=await c.post("/api/workspaces",{data:{name:`Video ${tag} ${Date.now()}`}});expect(response.status(),await response.text()).toBe(201);
  return {client:c,workspaceId:(await response.json()).workspace.id as string};
}
async function product(c:APIRequestContext,ws:string,tag:string){
  const fields={brand:"Phase Four",name:`Video Cream ${tag}`,category:"Care",sku:`VIDEO-${tag}`,description:"First version",keySellingPoints:["Clear benefit"],targetAudience:"Adults"};
  const created=await c.post(`/api/workspaces/${ws}/products`,{data:fields});expect(created.status(),await created.text()).toBe(201);const id=(await created.json()).product.id as string;
  const png=await sharp({create:{width:640,height:640,channels:3,background:"#eac1ad"}}).png().toBuffer();
  const intentResponse=await c.post(`/api/workspaces/${ws}/products/${id}/assets/upload-intents`,{data:{purpose:"FRONT",mimeType:"image/png",byteSize:png.length,filename:"front.png",sha256:createHash("sha256").update(png).digest("hex"),sourceType:"CUSTOMER_OWNED",permissionConfirmed:true,permissionNote:"Test fixture"}});
  expect(intentResponse.status(),await intentResponse.text()).toBe(201);const intent=(await intentResponse.json()).intent as {assetId:string;versionId:string;uploadUrl:string;requiredHeaders:Record<string,string>};
  const sent=await fetch(intent.uploadUrl,{method:"PUT",headers:intent.requiredHeaders,body:new Uint8Array(png)});expect(sent.status,await sent.text()).toBe(200);
  const done=await c.post(`/api/workspaces/${ws}/products/${id}/assets/${intent.assetId}/versions/${intent.versionId}/finalize`,{data:{}});expect(done.status(),await done.text()).toBe(200);
  expect((await c.post(`/api/workspaces/${ws}/products/${id}/activate`,{data:{}})).status()).toBe(200);
  return {id,versionId:intent.versionId,fields};
}
function payload(productId:string,key:string,extra:Record<string,unknown>={}){return {productId,prompt:"A calm close-up of the product on a marble table with a gentle camera move.",tier:"QUALITY",durationSeconds:5,aspectRatio:"1:1",quantity:1,idempotencyKey:key,...extra};}
async function create(c:APIRequestContext,ws:string,data:Record<string,unknown>,scenario?:string){return c.post(scenario?"/api/dev/ai-video-jobs":`/api/workspaces/${ws}/ai-videos`,{data:scenario?{...data,workspaceId:ws,scenario}:data});}
async function settle(db:pg.Client,id:string,terminal:string[],timeout=60000){const start=Date.now();for(;;){tick();const row=(await db.query<{status:string}>("SELECT status FROM jobs WHERE id=$1",[id])).rows[0];if(terminal.includes(row?.status))return row.status;if(Date.now()-start>timeout)throw new Error(`Video Job ${id} stuck in ${row?.status}`);await new Promise(r=>setTimeout(r,350));}}

test("AI Video durable provider path, failures and workspace isolation",async()=>{
  test.setTimeout(240_000);
  const tag=String(Date.now()),a=await account(`a-${tag}`),b=await account(`b-${tag}`),db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
  try{
    const p=await product(a.client,a.workspaceId,tag),data=payload(p.id,`p4-main-${tag}`),path=`/api/workspaces/${a.workspaceId}/ai-videos`;
    const invalid=await create(a.client,a.workspaceId,{...data,durationSeconds:31});expect(invalid.status()).toBe(400);
    const unsupported=await create(a.client,a.workspaceId,{...data,aspectRatio:"2:3"});expect(unsupported.status()).toBe(400);
    const concurrent=await Promise.all([create(a.client,a.workspaceId,data),create(a.client,a.workspaceId,data)]);
    expect(concurrent.map(x=>x.status()).sort()).toEqual([200,201]);
    const ids=await Promise.all(concurrent.map(async x=>(await x.json()).job.id as string));expect(ids[0]).toBe(ids[1]);const id=ids[0];
    expect((await create(a.client,a.workspaceId,{...data,prompt:"A different customer prompt that still meets the length requirement."})).status()).toBe(409);
    const frozen=(await db.query<{input_snapshot:{product:{versionId:string;assets:{assetVersionId:string}[]}}}>("SELECT input_snapshot FROM jobs WHERE id=$1",[id])).rows[0].input_snapshot;
    expect(frozen.product.assets.some(x=>x.assetVersionId===p.versionId)).toBeTruthy();
    const updated=await a.client.patch(`/api/workspaces/${a.workspaceId}/products/${p.id}`,{data:{...p.fields,description:"Second version"}});expect(updated.status(),await updated.text()).toBe(200);
    const retry=await create(a.client,a.workspaceId,data);expect(retry.status()).toBe(200);expect((await retry.json()).job.id).toBe(id);
    await concurrentTicks();
    await new Promise(r=>setTimeout(r,700));
    await db.query("UPDATE provider_executions SET next_action_at=now() WHERE job_id=$1 AND state IN ('SUBMITTED','RUNNING')",[id]);
    await concurrentTicks();
    expect(await settle(db,id,["SUCCEEDED"])).toBe("SUCCEEDED");
    const counts=(await db.query<{executions:string;submissions:string;artifacts:string;success_events:string}>(`SELECT
      (SELECT count(*) FROM provider_executions WHERE job_id=$1) AS executions,
      (SELECT sum(submit_count) FROM provider_executions WHERE job_id=$1) AS submissions,
      (SELECT count(*) FROM job_artifacts WHERE job_id=$1 AND status='READY') AS artifacts,
      (SELECT count(*) FROM job_events WHERE job_id=$1 AND event_type='JOB_SUCCEEDED') AS success_events`,[id])).rows[0];
    expect(counts).toMatchObject({executions:"1",submissions:"1",artifacts:"1",success_events:"1"});
    const detailResponse=await a.client.get(`${path}/${id}`);expect(detailResponse.status()).toBe(200);const detail=(await detailResponse.json()).job;
    expect(detail.productVersion).toBe(1);expect(detail.artifacts).toHaveLength(1);
    const artifactId=detail.artifacts[0].id as string;
    const signed=await a.client.get(`${path}/${id}/artifacts/${artifactId}/download`);expect(signed.status()).toBe(200);
    const url=(await signed.json()).url as string,bytes=Buffer.from(await (await fetch(url)).arrayBuffer());expect(bytes.toString("ascii",4,8)).toBe("ftyp");expect(createHash("sha256").update(bytes).digest("hex")).toBe(detail.artifacts[0].sha256);
    for(const denied of [await b.client.get(`${path}/${id}`),await b.client.get(`${path}/${id}/artifacts/${artifactId}/download`),await b.client.post(`/api/workspaces/${a.workspaceId}/jobs/${id}/cancel`,{data:{}}),await b.client.get(`/api/workspaces/${a.workspaceId}/jobs/${id}`),await b.client.get(`/api/workspaces/${a.workspaceId}/products/${p.id}`),await b.client.get(`/api/workspaces/${b.workspaceId}/ai-videos/${id}`),await b.client.get(`/api/workspaces/${b.workspaceId}/ai-videos/${id}/artifacts/${artifactId}/download`)])expect([403,404]).toContain(denied.status());
    const bHistory=await (await b.client.get(`/api/workspaces/${b.workspaceId}/ai-videos`)).json();expect(JSON.stringify(bHistory)).not.toContain(id);
    const next=await create(a.client,a.workspaceId,payload(p.id,`p4-v2-${tag}`));expect(next.status()).toBe(201);const nextId=(await next.json()).job.id as string;
    const nextInput=(await db.query<{input_snapshot:{product:{versionNumber:number}}}>("SELECT input_snapshot FROM jobs WHERE id=$1",[nextId])).rows[0].input_snapshot;expect(nextInput.product.versionNumber).toBe(2);
    const queued=await create(a.client,a.workspaceId,payload(p.id,`p4-cancel-${tag}`));const queuedId=(await queued.json()).job.id as string;
    expect((await a.client.post(`/api/workspaces/${a.workspaceId}/jobs/${queuedId}/cancel`,{data:{}})).status()).toBe(200);tick();expect((await db.query("SELECT status FROM jobs WHERE id=$1",[queuedId])).rows[0].status).toBe("CANCELLED");
    for(const [scenario,expected] of [["FAILURE","FAILED"],["SUBMISSION_UNKNOWN","SUCCEEDED"],["DOWNLOAD_FAIL_ONCE","SUCCEEDED"],["OVERSIZED_OUTPUT","FAILED"],["INVALID_MIME","FAILED"],["INVALID_CHECKSUM","FAILED"]] as const){
      const response=await create(a.client,a.workspaceId,payload(p.id,`p4-${scenario}-${tag}`),scenario);expect(response.status(),await response.text()).toBe(201);const scenarioId=(await response.json()).job.id as string;
      expect(await settle(db,scenarioId,["SUCCEEDED","FAILED"])).toBe(expected);
      const execution=(await db.query<{submit_count:number;ingest_count:number;state:string}>("SELECT submit_count,ingest_count,state FROM provider_executions WHERE job_id=$1",[scenarioId])).rows[0];expect(execution.submit_count).toBe(1);
      if(scenario==="DOWNLOAD_FAIL_ONCE")expect(execution.ingest_count).toBe(2);
      if(scenario==="SUBMISSION_UNKNOWN")expect((await db.query("SELECT count(*) AS n FROM job_events WHERE job_id=$1 AND event_type='PROVIDER_SUBMISSION_RECOVERED'",[scenarioId])).rows[0].n).toBe("1");
    }
    const rate=await create(a.client,a.workspaceId,payload(p.id,`p4-rate-${tag}`),"RATE_LIMIT");expect(rate.status()).toBe(201);const rateId=(await rate.json()).job.id as string;
    expect(await settle(db,rateId,["SUCCEEDED"],75000)).toBe("SUCCEEDED");
    const executions=(await db.query<{submit_count:number;state:string}>("SELECT submit_count,state FROM provider_executions WHERE job_id=$1 ORDER BY attempt_number",[rateId])).rows;expect(executions).toHaveLength(2);expect(executions[0]).toMatchObject({submit_count:1,state:"FAILED"});expect(executions[1]).toMatchObject({submit_count:1,state:"SUCCEEDED"});
  }finally{await Promise.all([a.client.dispose(),b.client.dispose()]);await db.end();}
});
