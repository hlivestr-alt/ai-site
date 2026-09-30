import { spawn, execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import sharp from "sharp";

process.loadEnvFile(".env.local");
const base="http://127.0.0.1:3200",stamp=Date.now();
const env={...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,OBJECT_STORAGE_BUCKET:process.env.TEST_OBJECT_STORAGE_BUCKET,APP_BASE_URL:base,APP_ENV:"local",MAIL_MODE:"development_file",VIDEO_PROVIDER:"fake",ENABLE_FAKE_VIDEO_PROVIDER:"1"};
if(!env.TEST_DATABASE_URL||!env.TEST_OBJECT_STORAGE_BUCKET)throw new Error("Isolated test database and bucket are required");
const db=new pg.Client({connectionString:env.DATABASE_URL});let app;const logs=[];
function check(value,message){if(!value)throw new Error(message);}
function stop(child){if(!child?.pid)return;try{execFileSync("taskkill",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore"});}catch{child.kill();}}
function startApp(){const child=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","-p","3200","-H","127.0.0.1"],{cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"],windowsHide:true});child.stdout.on("data",x=>logs.push(String(x)));child.stderr.on("data",x=>logs.push(String(x)));return child;}
async function until(fn,timeout=90000){const start=Date.now();for(;;){const value=await fn().catch(()=>null);if(value)return value;if(Date.now()-start>timeout)throw new Error(`Timed out. Recent app logs: ${logs.join("").slice(-1500)}`);await new Promise(r=>setTimeout(r,250));}}
async function api(path,data,cookie=""){const response=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",Origin:base,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});return {response,payload:await response.json().catch(()=>({}))};}
async function mail(email){return until(async()=>{const dir=join(process.cwd(),"data","mailbox"),files=(await readdir(dir).catch(()=>[])).filter(x=>x.endsWith(".json")).sort().reverse();for(const name of files){const item=JSON.parse(await readFile(join(dir,name),"utf8"));if(item.to===email&&item.subject.includes("Verify"))return item.url;}return null;},15000);}
function dispatch(){execFileSync(process.execPath,["--env-file=.env.local","--import","tsx","scripts/dispatcher.ts","--once"],{cwd:process.cwd(),env,stdio:"pipe",timeout:30000});}
async function main(){
  await db.connect();app=startApp();await until(async()=>{const r=await fetch(base+"/login");return r.ok;});
  const email=`p4-restart-${stamp}@example.test`;
  const registered=await api("/api/auth/register",{email,displayName:"Video Restart Owner",password:"ValidPassword123!"});check(registered.response.status===201,"Registration failed");
  const token=new URL(await mail(email)).searchParams.get("token"),verified=await api("/api/auth/verify",{token});check(verified.response.ok,"Verification failed");
  const cookie=verified.response.headers.get("set-cookie")?.split(";")[0];check(cookie,"Session cookie missing");
  const ws=await api("/api/workspaces",{name:`Video Restart ${stamp}`},cookie);check(ws.response.status===201,"Workspace creation failed");const workspaceId=ws.payload.workspace.id;
  const product=await api(`/api/workspaces/${workspaceId}/products`,{brand:"Restart Brand",name:"Restart Product",category:"Care",sku:`RESTART-${stamp}`,description:"Stable Product",keySellingPoints:["Feature"],targetAudience:"Adults"},cookie);check(product.response.status===201,"Product creation failed");const productId=product.payload.product.id;
  const png=await sharp({create:{width:640,height:640,channels:3,background:"#cb997d"}}).png().toBuffer();
  const intent=await api(`/api/workspaces/${workspaceId}/products/${productId}/assets/upload-intents`,{purpose:"FRONT",mimeType:"image/png",byteSize:png.length,filename:"front.png",sha256:createHash("sha256").update(png).digest("hex"),sourceType:"CUSTOMER_OWNED",permissionConfirmed:true,permissionNote:"Test image"},cookie);check(intent.response.status===201,"Upload intent failed");
  const upload=intent.payload.intent,sent=await fetch(upload.uploadUrl,{method:"PUT",headers:upload.requiredHeaders,body:new Uint8Array(png)});check(sent.ok,"Reference upload failed");
  const done=await api(`/api/workspaces/${workspaceId}/products/${productId}/assets/${upload.assetId}/versions/${upload.versionId}/finalize`,{},cookie);check(done.response.ok,"Reference finalize failed");
  check((await api(`/api/workspaces/${workspaceId}/products/${productId}/activate`,{},cookie)).response.ok,"Product activation failed");
  const video=await api(`/api/workspaces/${workspaceId}/ai-videos`,{productId,prompt:"Show the saved Product in a bright studio with a slow orbit camera move.",tier:"QUALITY",durationSeconds:5,aspectRatio:"1:1",quantity:1,idempotencyKey:`restart-video-${stamp}`},cookie);check(video.response.status===201,"AI Video creation failed");const jobId=video.payload.job.id;
  dispatch();const before=(await db.query("SELECT id,submit_count,external_task_id,state FROM provider_executions WHERE job_id=$1",[jobId])).rows[0];check(before?.submit_count===1&&before.external_task_id,"Provider task was not submitted");
  stop(app);app=null;await new Promise(r=>setTimeout(r,1000));
  app=startApp();await until(async()=>{const r=await fetch(base+"/login");return r.ok;});
  const visible=await fetch(`${base}/api/workspaces/${workspaceId}/ai-videos/${jobId}`,{headers:{Cookie:cookie}});check(visible.ok,"Video Job was not readable after restart");
  await until(async()=>{dispatch();const row=(await db.query("SELECT status FROM jobs WHERE id=$1",[jobId])).rows[0];return row.status==="SUCCEEDED";},60000);
  const after=(await db.query("SELECT id,submit_count,external_task_id,state FROM provider_executions WHERE job_id=$1",[jobId])).rows[0];check(after.id===before.id&&after.submit_count===1&&after.external_task_id===before.external_task_id&&after.state==="SUCCEEDED","Restart created another submission");
  const artifact=(await db.query("SELECT id,status FROM job_artifacts WHERE job_id=$1",[jobId])).rows;check(artifact.length===1&&artifact[0].status==="READY","Restart result missing");
  console.log(JSON.stringify({result:"passed",appRestart:true,dispatcherRestart:true,jobId,providerExecutionId:after.id,submissions:after.submit_count,artifacts:artifact.length}));
}
try{await main();}finally{stop(app);await db.end().catch(()=>{});}
