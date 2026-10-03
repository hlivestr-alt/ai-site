import {test,expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import pg from "pg";
import {owner,source,submit,worker,provision,dispatch,lease,publish,type Claim} from "../clipper-helpers";

test("Clipper source, duplicate submit, private artifacts, multi-output completion and workspace isolation",async({browser})=>{
  test.setTimeout(180000);const stamp=Date.now(),a=await owner(`p5-a-${stamp}@example.test`),b=await owner(`p5-b-${stamp}@example.test`),w=provision(`p5-contract-${stamp}`,2),c=await worker(w.credential,2);const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
  try{
    const s=await source(a.c,a.workspaceId);const path=`/api/workspaces/${a.workspaceId}/sources/${s.id}`;
    expect((await b.c.get(`${path}/download`)).status()).toBe(404);expect((await b.c.get(`/api/workspaces/${b.workspaceId}/sources/${s.id}/download`)).status()).toBe(404);expect((await submit(b.c,b.workspaceId,s.id,`foreign-${stamp}`)).status()).toBe(404);
    const responses=await Promise.all([submit(a.c,a.workspaceId,s.id,`same-${stamp}`),submit(a.c,a.workspaceId,s.id,`same-${stamp}`)]);expect(responses.map(r=>r.status()).sort()).toEqual([200,201]);const values=await Promise.all(responses.map(r=>r.json()));const jobId=values[0].job.id;expect(values[1].job.id).toBe(jobId);expect((await submit(a.c,a.workspaceId,s.id,`same-${stamp}`,{targetClipCount:1})).status()).toBe(409);
    dispatch();const claim=(await (await c.post("/api/worker/claim",{data:{}})).json()).claim as Claim;expect(claim.jobId).toBe(jobId);expect(JSON.stringify(claim.inputSnapshot)).not.toContain("storageKey");
    expect((await c.post(`/api/worker/jobs/${jobId}/source/download`,{data:{...lease(claim),sourceAssetId:claim.attemptId}})).status()).toBe(404);
    expect((await c.post(`/api/worker/jobs/${jobId}/source/download`,{data:{...lease(claim),sourceAssetId:s.id,storageKey:"arbitrary"}})).status()).toBe(400);
    expect((await c.post(`/api/worker/jobs/${jobId}/source/verify`,{data:{...lease(claim),sourceAssetId:s.id,byteSize:s.byteSize,sha256:s.sha256,durationSeconds:57.466667,width:320,height:180,hasAudio:true}})).status()).toBe(200);
    const transcript=await publish(c,claim,"transcript",Buffer.from(JSON.stringify({schemaVersion:3,sourceAssetId:s.id,sourceSha256:s.sha256,duration:57.466667,language:"en",segments:[{start:0,end:40,text:"Known fixture speech"}],words:[],metadata:{transcriber:"fixture"}})));
    const clips=[{start:0,end:10,score:90,hook:"Idea one",reason:"Useful information",tags:["idea"]},{start:15,end:25,score:85,hook:"Idea two",reason:"Another thought",tags:["reaction"]}];
    const inputHash=(await db.query("SELECT input_hash FROM jobs WHERE id=$1",[jobId])).rows[0].input_hash;
    const plan=await publish(c,claim,"clip-plan",Buffer.from(JSON.stringify({schemaVersion:1,sourceAssetId:s.id,sourceSha256:s.sha256,inputHash,transcriptArtifactId:transcript.id,analyzerPolicyVersion:"clip-selection-v1",clips})));
    const video=await readFile("tests/fixtures/clipper-output.mp4"),out1=await publish(c,claim,"clip_001",video,"video/mp4"),out2=await publish(c,claim,"clip_002",video,"video/mp4");
    // An old signed PUT can still address staging, but cannot replace the READY object.
    expect((await fetch(out1.uploadUrl,{method:"PUT",headers:{"Content-Type":"video/mp4"},body:Buffer.from("changed")})).ok).toBe(true);
    const manifest={...lease(claim),artifactIds:[transcript.id,plan.id,out1.id,out2.id],transcriptArtifactId:transcript.id,planArtifactId:plan.id,clips:clips.map((clip,i)=>({...clip,artifactId:i?out2.id:out1.id,duration:10,width:720,height:1280,sha256:out1.sha256}))};
    expect((await c.post(`/api/worker/jobs/${jobId}/complete`,{data:{...manifest,clips:[{...manifest.clips[0],start:-1},manifest.clips[1]]}})).status()).toBe(422);
    await db.query("UPDATE jobs SET error_code='LEASE_EXPIRED',error_message_safe='Retry scheduled.' WHERE id=$1",[jobId]);
    const finished=await c.post(`/api/worker/jobs/${jobId}/complete`,{data:manifest});expect(finished.status(),await finished.text()).toBe(200);expect((await (await c.post(`/api/worker/jobs/${jobId}/complete`,{data:manifest})).json()).duplicate).toBe(true);
    expect((await db.query("SELECT error_code,error_message_safe FROM jobs WHERE id=$1",[jobId])).rows[0]).toEqual({error_code:null,error_message_safe:null});
    for(const id of manifest.artifactIds){expect((await b.c.get(`/api/workspaces/${b.workspaceId}/clipper/${jobId}/artifacts/${id}/download`)).status()).toBe(404);expect((await b.c.get(`/api/workspaces/${a.workspaceId}/clipper/${jobId}/artifacts/${id}/download`)).status()).toBe(404);}
    expect((await b.c.get(`/api/workspaces/${b.workspaceId}/clipper/${jobId}`)).status()).toBe(404);expect((await b.c.post(`/api/workspaces/${a.workspaceId}/jobs/${jobId}/cancel`)).status()).toBe(404);
    const access=await a.c.get(`/api/workspaces/${a.workspaceId}/clipper/${jobId}/artifacts/${out1.id}/download`);expect(access.status()).toBe(200);expect(Buffer.from(await (await fetch((await access.json()).url)).arrayBuffer())).toEqual(video);
    const user=(await b.c.get("/api/auth/session"));const userId=(await user.json()).user.id;await db.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'VIEWER')",[a.workspaceId,userId]);
    expect((await b.c.post(`/api/workspaces/${a.workspaceId}/select`)).status()).toBe(200);expect((await b.c.get(`/api/workspaces/${a.workspaceId}/clipper/${jobId}`)).status()).toBe(200);expect((await submit(b.c,a.workspaceId,s.id,`viewer-${stamp}`)).status()).toBe(403);expect((await b.c.post(`/api/workspaces/${a.workspaceId}/jobs/${jobId}/cancel`)).status()).toBe(403);
    const viewerContext=await browser.newContext({storageState:await b.c.storageState()});try{const page=await viewerContext.newPage();await page.goto((process.env.SAAS_TEST_BASE_URL||"http://127.0.0.1:3200")+"/clipper");await expect(page.getByRole("button",{name:"Start clipping",exact:true})).toBeDisabled();await expect(page.getByLabel("Upload source video")).toBeDisabled();await page.goto(`${process.env.SAAS_TEST_BASE_URL||"http://127.0.0.1:3200"}/clipper/${jobId}`);await expect(page.getByRole("heading",{name:"Transcript and clip plan"})).toBeVisible();await expect(page.getByRole("link",{name:"Download clip 1",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Request cancellation"})).toHaveCount(0);}finally{await viewerContext.close();}
  }finally{await Promise.all([a.c.dispose(),b.c.dispose(),c.dispose()]);await db.end();}
});

test("multipart upload resumes individual parts and finalized source is immutable",async()=>{
  test.setTimeout(180000);const a=await owner(`p5-multipart-${Date.now()}@example.test`);try{
    const size=64*1024**2+5*1024**2,r=await a.c.post(`/api/workspaces/${a.workspaceId}/sources`,{data:{filename:"large-fixture.mp4",mimeType:"video/mp4",byteSize:size}});expect(r.status()).toBe(201);const intent=await r.json();expect(intent.mode).toBe("multipart");
    const prefix=Buffer.alloc(intent.partSize);Buffer.from([0,0,0,24]).copy(prefix);prefix.write("ftypisom",4);const endpoint=`/api/workspaces/${a.workspaceId}/sources/${intent.source.id}`;
    const p1=await a.c.post(`${endpoint}/parts`,{data:{partNumber:1}});expect((await fetch((await p1.json()).url,{method:"PUT",body:prefix})).ok).toBe(true);
    expect((await a.c.post(`${endpoint}/finalize`)).status()).toBe(409);const resumed=await a.c.get(`${endpoint}/upload`);expect((await resumed.json()).parts.map((p:{partNumber:number})=>p.partNumber)).toEqual([1]);
    expect((await a.c.post(`${endpoint}/parts`,{data:{partNumber:3}})).status()).toBe(400);const p2=await a.c.post(`${endpoint}/parts`,{data:{partNumber:2}});expect((await fetch((await p2.json()).url,{method:"PUT",body:Buffer.alloc(5*1024**2)})).ok).toBe(true);
    expect((await a.c.post(`${endpoint}/finalize`)).status()).toBe(200);expect((await a.c.post(`${endpoint}/finalize`)).status()).toBe(200);expect((await a.c.post(`${endpoint}/parts`,{data:{partNumber:1}})).status()).toBe(409);
  }finally{await a.c.dispose();}
});

test("two Clipper workers obey per-worker GPU capacity, cancellation, retry and fencing",async()=>{
  const stamp=Date.now(),a=await owner(`p5-leases-${stamp}@example.test`),w1=provision(`p5-w1-${stamp}`,2),w2=provision(`p5-w2-${stamp}`,2),c1=await worker(w1.credential,2),c2=await worker(w2.credential,2);const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();try{
    const s=await source(a.c,a.workspaceId);const ids=[];for(let i=0;i<3;i++){const r=await submit(a.c,a.workspaceId,s.id,`capacity-${stamp}-${i}`);ids.push((await r.json()).job.id);}dispatch();
    const claims=await Promise.all([c1.post("/api/worker/claim",{data:{}}),c2.post("/api/worker/claim",{data:{}})]);const [v1,v2]=await Promise.all(claims.map(r=>r.json()));const old=v1.claim as Claim,next=v2.claim as Claim;expect(old.jobId).not.toBe(next.jobId);expect((await (await c1.post("/api/worker/claim",{data:{}})).json()).claim).toBeNull();
    await db.query("UPDATE worker_leases SET expires_at=now()-interval '1 second' WHERE id=$1",[old.leaseId]);dispatch();expect((await c1.post(`/api/worker/jobs/${old.jobId}/progress`,{data:{...lease(old),sequence:1,percent:25,stage:"TRANSCRIBING",message:"late"}})).status()).toBe(409);expect((await c1.post(`/api/worker/jobs/${old.jobId}/complete`,{data:{...lease(old),artifactIds:[]}})).status()).toBe(409);
    await new Promise(r=>setTimeout(r,1200));dispatch();await a.c.post(`/api/workspaces/${a.workspaceId}/jobs/${next.jobId}/cancel`);expect((await (await c2.post(`/api/worker/jobs/${next.jobId}/renew`,{data:lease(next)})).json()).cancelRequested).toBe(true);expect((await c2.post(`/api/worker/jobs/${next.jobId}/source/download`,{data:{...lease(next),sourceAssetId:s.id}})).status()).toBe(409);await c2.post(`/api/worker/jobs/${next.jobId}/fail`,{data:{...lease(next),errorCode:"CANCELLED",retriable:false,message:"Cancelled"}});
    for(const id of ids)await a.c.post(`/api/workspaces/${a.workspaceId}/jobs/${id}/cancel`);
  }finally{await Promise.all([a.c.dispose(),c1.dispose(),c2.dispose()]);await db.end();}
});
