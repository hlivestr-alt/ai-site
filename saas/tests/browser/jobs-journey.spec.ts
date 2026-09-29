import { test, expect } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import pg from "pg";

const base="http://127.0.0.1:3200";
async function mail(to:string){for(let i=0;i<50;i++){const folder=join(process.cwd(),"data","mailbox"),files=(await readdir(folder).catch(()=>[])).filter(x=>x.endsWith(".json")).sort().reverse();for(const file of files){const item=JSON.parse(await readFile(join(folder,file),"utf8"));if(item.to===to&&item.subject.includes("Verify"))return item.url as string;}await new Promise(r=>setTimeout(r,100));}throw new Error("Verification mail missing");}
function provision(name:string,capability:string){const output=execFileSync(process.execPath,["--env-file=.env.local","scripts/worker-admin.mjs","create",name,capability,"2","--test"],{cwd:process.cwd(),encoding:"utf8"});return JSON.parse(output) as {workerId:string;credential:string};}
function dispatcher():ChildProcess{return spawn(process.execPath,["--env-file=.env.local","--import","tsx","scripts/dispatcher.ts"],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,OBJECT_STORAGE_BUCKET:process.env.TEST_OBJECT_STORAGE_BUCKET,DISPATCHER_POLL_MS:"200",JOB_RETRY_BASE_MS:"1000"},stdio:["ignore","pipe","pipe"],windowsHide:true});}
function agent(credential:string,stamp:number):ChildProcess{return spawn("python",["worker_agent.py"],{cwd:resolve(process.cwd(),"..","worker-agent"),env:{...process.env,SAAS_BASE_URL:base,WORKER_TOKEN:credential,WORKER_MAX_CONCURRENCY:"2",WORKER_POLL_SECONDS:"0.2",WORKER_HEARTBEAT_SECONDS:"1",WORKER_WORK_DIR:resolve(process.cwd(),"..","worker-agent","data",`browser-${stamp}`)},stdio:["ignore","pipe","pipe"],windowsHide:true});}
async function waitDone(db:pg.Client,ids:string[],timeout=180_000){const started=Date.now();for(;;){const rows=await db.query<{id:string;status:string;attempt_count:number}>("SELECT id,status,attempt_count FROM jobs WHERE id=ANY($1::uuid[])",[ids]);if(rows.rows.length===ids.length&&rows.rows.every(x=>x.status==="SUCCEEDED"))return rows.rows;if(Date.now()-started>timeout)throw new Error(`Fixture Jobs did not all finish: ${JSON.stringify(rows.rows)}`);await new Promise(r=>setTimeout(r,300));}}

test("browser closure leaves ten fixture jobs running in the private agent",async({page,browser})=>{
  test.setTimeout(240_000);
  const stamp=Date.now(),email=`p3-browser-${stamp}@example.test`,capability=`SYSTEM_TEST_${stamp}`;
  await page.goto("/register");await page.getByLabel("Email address").fill(email);await page.getByLabel("Your name").fill("Job Browser Owner");await page.getByLabel("Password").fill("ValidPassword123!");await page.getByRole("button",{name:/Create account/}).click();
  await page.goto(await mail(email));await page.getByRole("button",{name:/Verify email/}).click();
  await page.getByLabel("Workspace name").fill(`Fixture Brand ${stamp}`);await page.getByRole("button",{name:/Create workspace/}).click();
  const workspaceId=(await (await page.request.get("/api/auth/session")).json()).currentWorkspace.id as string;
  const headers={Origin:base,"x-diagnostic-token":process.env.DEV_DIAGNOSTIC_TOKEN||""};
  const jobs:string[]=[];
  for(let i=0;i<10;i++){const result=await page.request.post("/api/dev/fixture-jobs",{headers,data:{workspaceId,idempotencyKey:`browser-${stamp}-${i}`,steps:3,delayMs:100,capability}});expect(result.status(),await result.text()).toBe(201);jobs.push((await result.json()).job.id);}
  const storageState=await page.context().storageState();await page.close();
  const worker=provision(`browser-worker-${stamp}`,capability),db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
  let dispatch:ChildProcess|undefined,processAgent:ChildProcess|undefined;const workerLogs:string[]=[],dispatcherLogs:string[]=[];
  try{
    dispatch=dispatcher();processAgent=agent(worker.credential,stamp);
    for(const [process,logs] of [[dispatch,dispatcherLogs],[processAgent,workerLogs]] as const){process.stdout?.on("data",x=>logs.push(String(x)));process.stderr?.on("data",x=>logs.push(String(x)));}
    const completed=await waitDone(db,jobs).catch(error=>{throw new Error(`${error instanceof Error?error.message:error}\nWorker: ${workerLogs.join("").slice(-4000)}\nDispatcher: ${dispatcherLogs.join("").slice(-2000)}`);});expect(completed.every(row=>row.attempt_count===1)).toBe(true);
    const attempts=await db.query<{job_id:string;count:string}>("SELECT job_id,count(*) FROM job_attempts WHERE job_id=ANY($1::uuid[]) GROUP BY job_id",[jobs]);expect(attempts.rows.every(x=>x.count==="1")).toBe(true);
    const events=await db.query<{job_id:string;percent:number}>("SELECT job_id,(safe_data->>'percent')::integer AS percent FROM job_events WHERE job_id=ANY($1::uuid[]) AND event_type='JOB_PROGRESS' ORDER BY created_at,id",[jobs]);
    for(const jobId of jobs){const percentages=events.rows.filter(x=>x.job_id===jobId).map(x=>x.percent);expect(percentages).toHaveLength(3);expect(percentages).toEqual([...percentages].sort((a,b)=>a-b));}
    const leases=await db.query<{created_at:Date;ended_at:Date}>("SELECT created_at,ended_at FROM worker_leases WHERE job_id=ANY($1::uuid[]) ORDER BY created_at",[jobs]);
    const points=leases.rows.flatMap(x=>[{time:new Date(x.created_at).getTime(),delta:1},{time:new Date(x.ended_at).getTime(),delta:-1}]).sort((a,b)=>a.time-b.time||a.delta-b.delta);let concurrent=0,peak=0;for(const point of points){concurrent+=point.delta;peak=Math.max(peak,concurrent);}expect(peak).toBeLessThanOrEqual(2);expect(peak).toBeGreaterThan(0);
    const reopened=await browser.newContext({storageState}),view=await reopened.newPage();
    try{await view.goto(`/jobs/${jobs[0]}`);await expect(view.getByRole("heading",{name:`Job ${jobs[0].slice(0,8)}`})).toBeVisible();await expect(view.getByText("SUCCEEDED",{exact:true})).toBeVisible();await view.goto("/");await expect(view.locator(".stat-card").nth(2).locator("strong")).toHaveText("0");}
    finally{await reopened.close();}
  } finally {processAgent?.kill();dispatch?.kill();await db.end();}
});
