import {paidPost} from "./billing-helpers";
import {expect,type APIRequestContext} from "@playwright/test";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile} from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
import {source,submit,worker,provision,dispatch,lease,publish,type Claim} from "./clipper-helpers";
export function contentEnv(){return {...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,OBJECT_STORAGE_BUCKET:process.env.TEST_OBJECT_STORAGE_BUCKET,APP_ENV:"local",VIDEO_PROVIDER:"fake",ENABLE_FAKE_VIDEO_PROVIDER:"1",ENABLE_FAKE_CLIP_ANALYZER:"1"};}
export function publishJob(ws:string,id:string,count=1){return JSON.parse(execFileSync(process.execPath,["--env-file=.env.local","--import","tsx","tests/invoke-publication.ts",ws,id,String(count)],{cwd:process.cwd(),env:contentEnv(),encoding:"utf8",windowsHide:true}));}
export function posters(extra:Record<string,string>={},versionId=""){return JSON.parse(execFileSync(process.execPath,["--env-file=.env.local","--import","tsx","tests/invoke-publication.ts","--poster",versionId],{cwd:process.cwd(),env:{...contentEnv(),...extra},encoding:"utf8",windowsHide:true}));}
export function approved(ws:string,id:string,versionId:string){return JSON.parse(execFileSync(process.execPath,["--env-file=.env.local","--import","tsx","tests/invoke-publication.ts","--approved",ws,id,versionId],{cwd:process.cwd(),env:contentEnv(),encoding:"utf8",windowsHide:true}));}
export const fields={brand:"Review Brand",name:"Historical Product",category:"Care",description:"Saved first-version context",keySellingPoints:["Known factual benefit"],targetAudience:"Adults"};
export async function imageReference(c:APIRequestContext,ws:string,pid:string,assetId?:string,color="#eac1ad"){
  const png=await sharp({create:{width:640,height:640,channels:3,background:color}}).png().toBuffer(),path=`/api/workspaces/${ws}/products/${pid}/assets`;
  const r=await c.post(assetId?`${path}/${assetId}/upload-intents`:`${path}/upload-intents`,{data:{purpose:"FRONT",mimeType:"image/png",byteSize:png.length,filename:"reference.png",sha256:createHash("sha256").update(png).digest("hex"),sourceType:"CUSTOMER_OWNED",permissionConfirmed:true,permissionNote:"Synthetic test reference"}});expect(r.status(),await r.text()).toBe(201);const intent=(await r.json()).intent;
  expect((await fetch(intent.uploadUrl,{method:"PUT",headers:intent.requiredHeaders,body:png})).ok).toBe(true);expect((await c.post(`${path}/${intent.assetId}/versions/${intent.versionId}/finalize`)).status()).toBe(200);return {assetId:intent.assetId as string,versionId:intent.versionId as string,png};
}
export async function product(c:APIRequestContext,ws:string){const r=await c.post(`/api/workspaces/${ws}/products`,{data:fields});expect(r.status()).toBe(201);const id=(await r.json()).product.id as string,reference=await imageReference(c,ws,id);expect((await c.post(`/api/workspaces/${ws}/products/${id}/activate`)).status()).toBe(200);return {id,reference};}
export async function videoJob(c:APIRequestContext,ws:string,productId:string){const r=await paidPost(c,ws,"AI_VIDEO",{productId,prompt:"A controlled fake-provider video showing the saved Product on a studio table.",tier:"QUALITY",durationSeconds:5,aspectRatio:"1:1",quantity:1,idempotencyKey:`p6-video-${crypto.randomUUID()}`});expect(r.status(),await r.text()).toBe(201);return (await r.json()).job.id as string;}
export async function settle(db:pg.Client,id:string){for(let i=0;i<40;i++){dispatch();const j=(await db.query("SELECT status FROM jobs WHERE id=$1",[id])).rows[0];if(["SUCCEEDED","FAILED","CANCELLED"].includes(j.status))return j.status;await new Promise(r=>setTimeout(r,350));}throw new Error("Job did not settle");}
export async function blockPublication(db:pg.Client,id:string,stamp:string){const name=`p6_block_${stamp}`;await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.job_id='${id}'::uuid THEN RAISE EXCEPTION 'Controlled publication failure'; END IF; RETURN NEW; END $$`);await db.query(`CREATE TRIGGER ${name} BEFORE INSERT ON content_versions FOR EACH ROW EXECUTE FUNCTION ${name}()`);return async()=>{await db.query(`DROP TRIGGER IF EXISTS ${name} ON content_versions`);await db.query(`DROP FUNCTION IF EXISTS ${name}()`);};}
export async function fixtureClips(c:APIRequestContext,ws:string,db:pg.Client){
  const s=await source(c,ws),r=await submit(c,ws,s.id,`p6-clips-${Date.now()}`);expect(r.status()).toBe(201);const jobId=(await r.json()).job.id as string,w=provision(`p6-fixture-${Date.now()}`),client=await worker(w.credential);dispatch();
  try{const claim=(await (await client.post("/api/worker/claim",{data:{}})).json()).claim as Claim;expect(claim.jobId).toBe(jobId);
    expect((await client.post(`/api/worker/jobs/${jobId}/source/verify`,{data:{...lease(claim),sourceAssetId:s.id,byteSize:s.byteSize,sha256:s.sha256,durationSeconds:57.466667,width:320,height:180,hasAudio:true}})).status()).toBe(200);
    const transcript=await publish(client,claim,"transcript",Buffer.from(JSON.stringify({schemaVersion:3,sourceAssetId:s.id,sourceSha256:s.sha256,duration:57.466667,language:"en",segments:[{start:0,end:40,text:"Known fixture speech"}],words:[],metadata:{fingerprint:"deterministic-test-transcript"}})));
    const clips=[{start:0,end:10,score:90,hook:"First reviewable idea",reason:"Useful information",tags:["idea"]},{start:15,end:25,score:85,hook:"Second reviewable idea",reason:"Another thought",tags:["reaction"]}],inputHash=(await db.query("SELECT input_hash FROM jobs WHERE id=$1",[jobId])).rows[0].input_hash;
    const plan=await publish(client,claim,"clip-plan",Buffer.from(JSON.stringify({schemaVersion:1,sourceAssetId:s.id,sourceSha256:s.sha256,inputHash,transcriptArtifactId:transcript.id,transcriptFingerprint:"deterministic-test-transcript",analyzerPolicyVersion:"clip-selection-v1",analyzerProvider:"fake",analyzerModels:["fake-transcript-v1"],clips})));
    const video=await readFile("tests/fixtures/clipper-output.mp4"),out1=await publish(client,claim,"clip_001",video,"video/mp4"),out2=await publish(client,claim,"clip_002",video,"video/mp4");
    expect((await client.post(`/api/worker/jobs/${jobId}/complete`,{data:{...lease(claim),artifactIds:[transcript.id,plan.id,out1.id,out2.id],transcriptArtifactId:transcript.id,planArtifactId:plan.id,clips:clips.map((v,i)=>({...v,artifactId:i?out2.id:out1.id,duration:10,width:720,height:1280,sha256:out1.sha256}))}})).status()).toBe(200);
    return {jobId,source:s,transcriptId:transcript.id,planId:plan.id};
  }finally{await db.query("UPDATE workers SET status='DISABLED' WHERE id=$1",[w.workerId]);await client.dispose();}
}
