import { spawn, execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";

process.loadEnvFile(".env.local");
const base="http://127.0.0.1:3200",stamp=Date.now(),capability=`SYSTEM_TEST_${stamp}`;
const env={...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,OBJECT_STORAGE_BUCKET:process.env.TEST_OBJECT_STORAGE_BUCKET,APP_BASE_URL:base,APP_ENV:"local",MAIL_MODE:"development_file",JOB_RETRY_BASE_MS:"1000"};
const db=new pg.Client({connectionString:env.DATABASE_URL});
let app,agent;const appLogs=[];
function check(value,message){if(!value)throw new Error(message);}
function stop(child){if(!child?.pid)return;try{execFileSync("taskkill",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore"});}catch{child.kill();}}
async function until(fn,timeout=90000){const start=Date.now();for(;;){const value=await fn().catch(()=>null);if(value)return value;if(Date.now()-start>timeout)throw new Error("Timed out waiting for acceptance state");await new Promise(r=>setTimeout(r,250));}}
function startApp(){const child=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","-p","3200","-H","127.0.0.1"],{cwd:process.cwd(),env,stdio:["ignore","pipe","pipe"],windowsHide:true});child.stdout.on("data",x=>appLogs.push(String(x)));child.stderr.on("data",x=>appLogs.push(String(x)));return child;}
async function api(path,data,cookie="",extra={}){const response=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",Origin:base,...(cookie?{Cookie:cookie}:{}),...extra},body:JSON.stringify(data)});const payload=await response.json().catch(()=>({}));return {response,payload};}
async function mail(email){return until(async()=>{const folder=join(process.cwd(),"data","mailbox");const files=(await readdir(folder).catch(()=>[])).filter(x=>x.endsWith(".json")).sort().reverse();for(const file of files){const item=JSON.parse(await readFile(join(folder,file),"utf8"));if(item.to===email&&item.subject.includes("Verify"))return item.url;}return null;},10000);}
function dispatch(){const output=execFileSync(process.execPath,["--env-file=.env.local","--import","tsx","scripts/dispatcher.ts","--once"],{cwd:process.cwd(),env,encoding:"utf8",timeout:30000});return output;}
async function status(jobId){return (await db.query("SELECT status,attempt_count FROM jobs WHERE id=$1",[jobId])).rows[0];}
async function main(){
  check(env.TEST_DATABASE_URL&&env.TEST_OBJECT_STORAGE_BUCKET&&env.DEV_DIAGNOSTIC_TOKEN,"Test environment is incomplete");
  await db.connect();app=startApp();await until(async()=>{const r=await fetch(base+"/login");return r.ok;});
  const email=`p3-restart-${stamp}@example.test`;
  const registered=await api("/api/auth/register",{email,displayName:"Restart Owner",password:"ValidPassword123!"});check(registered.response.status===201,`registration failed (${registered.response.status}: ${JSON.stringify(registered.payload)}): ${appLogs.join("").slice(-2000)}`);
  const token=new URL(await mail(email)).searchParams.get("token");
  const verified=await api("/api/auth/verify",{token});check(verified.response.ok,"verification failed");
  const cookie=verified.response.headers.get("set-cookie")?.split(";")[0];check(cookie,"session cookie missing");
  const created=await api("/api/workspaces",{name:`Restart Brand ${stamp}`},cookie);check(created.response.status===201,"workspace creation failed");
  const workspaceId=created.payload.workspace.id;
  const job=await api("/api/dev/fixture-jobs",{workspaceId,idempotencyKey:`restart-${stamp}`,steps:20,delayMs:1000,capability},cookie,{"x-diagnostic-token":env.DEV_DIAGNOSTIC_TOKEN});
  check(job.response.status===201,"fixture Job creation failed");const jobId=job.payload.job.id;
  check((await status(jobId)).status==="QUEUED","Job was not queued");
  stop(app);app=null;await new Promise(r=>setTimeout(r,1000));
  app=startApp();await until(async()=>{const r=await fetch(base+"/login");return r.ok;});
  const afterRestart=await fetch(`${base}/api/workspaces/${workspaceId}/jobs/${jobId}`,{headers:{Cookie:cookie}});check(afterRestart.ok,"Job missing after SaaS restart");
  dispatch();check((await status(jobId)).status==="WAITING_FOR_WORKER","dispatcher did not release Job");
  dispatch();check((await db.query("SELECT count(*) AS n FROM job_attempts WHERE job_id=$1",[jobId])).rows[0].n==="1","dispatcher restart duplicated attempt");
  const provision=JSON.parse(execFileSync(process.execPath,["--env-file=.env.local","scripts/worker-admin.mjs","create",`restart-worker-${stamp}`,capability,"1","--test"],{cwd:process.cwd(),encoding:"utf8"}));
  const workerEnv={...process.env,SAAS_BASE_URL:base,WORKER_TOKEN:provision.credential,WORKER_MAX_CONCURRENCY:"1",WORKER_POLL_SECONDS:"0.2",WORKER_HEARTBEAT_SECONDS:"1",WORKER_WORK_DIR:resolve(process.cwd(),"..","worker-agent","data",`restart-${stamp}`)};
  function startAgent(){const child=spawn("python",["worker_agent.py"],{cwd:resolve(process.cwd(),"..","worker-agent"),env:workerEnv,stdio:["ignore","pipe","pipe"],windowsHide:true});child.stdout.on("data",()=>{});child.stderr.on("data",()=>{});return child;}
  agent=startAgent();await until(async()=>{const s=await status(jobId);return s.status==="RUNNING"&&s.attempt_count===1;},60000);
  const old=(await db.query("SELECT attempt_id,id,fencing_token FROM worker_leases WHERE job_id=$1 ORDER BY created_at LIMIT 1",[jobId])).rows[0];
  stop(agent);agent=null;
  await db.query("UPDATE worker_leases SET expires_at=now()-interval '1 second' WHERE id=$1",[old.id]);
  dispatch();check((await db.query("SELECT status FROM worker_leases WHERE id=$1",[old.id])).rows[0].status==="EXPIRED","old lease not fenced");
  await new Promise(r=>setTimeout(r,1200));dispatch();agent=startAgent();
  await until(async()=>{const s=await status(jobId);return s.status==="RUNNING"&&s.attempt_count===2;},60000);
  const late=await api(`/api/worker/jobs/${jobId}/complete`,{attemptId:old.attempt_id,leaseId:old.id,fencingToken:String(old.fencing_token),digest:createHash("sha256").update(`SYSTEM_TEST:${jobId}:20`).digest("hex"),artifactIds:[]},"",{Authorization:`Bearer ${provision.credential}`});
  check(late.response.status===409,"stale worker completion was accepted");
  await until(async()=>{const s=await status(jobId);return s.status==="SUCCEEDED";},120000);
  const attempts=(await db.query("SELECT attempt_number,status FROM job_attempts WHERE job_id=$1 ORDER BY attempt_number",[jobId])).rows;
  check(attempts.length===2&&attempts[0].status==="LOST"&&attempts[1].status==="SUCCEEDED","worker recovery history incorrect");
  console.log(JSON.stringify({result:"passed",appRestart:true,dispatcherRestart:true,workerRestart:true,lateCompletionRejected:true,jobId,attempts}));
}
try{await main();}finally{stop(agent);stop(app);await db.end().catch(()=>{});}
