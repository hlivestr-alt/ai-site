import {execFile,execFileSync,spawn} from "node:child_process";
import {promisify} from "node:util";
import {randomUUID} from "node:crypto";
import {expect,type APIRequestContext} from "@playwright/test";
import {contentEnv} from "./content-helpers";
import type {Claim} from "./clipper-helpers";
export const workflowEnv=()=>({...contentEnv(),ENABLE_TEST_BILLING:"1",WORKFLOW_MAX_TOKENS:"100000"});
const args=(id:string,admissions=2,crash?:string)=>["--env-file=.env.local","--import","tsx","tests/invoke-workflow.ts",id,String(admissions),...(crash?[crash]:[])];
export function tick(id:string,admissions=2){return JSON.parse(execFileSync(process.execPath,args(id,admissions),{env:workflowEnv(),encoding:"utf8",windowsHide:true}));}
export function asyncTick(id:string,admissions=2){return promisify(execFile)(process.execPath,args(id,admissions),{env:workflowEnv(),encoding:"utf8",windowsHide:true});}
export async function crashTick(id:string,point:string){let crashed=false;try{await promisify(execFile)(process.execPath,args(id,1,point),{env:workflowEnv(),windowsHide:true});}catch(e){crashed=typeof e==="object"&&e!==null&&"code" in e&&e.code===86;}expect(crashed).toBe(true);}
export function configuration(productId:string,extra:Record<string,unknown>={}){return {productId,scripts:["A calm morning skincare routine with the saved Product on a studio table."],videosPerScript:1,tier:"QUALITY",durationSeconds:5,aspectRatio:"1:1",maxTokens:"5000",...extra};}
export async function definition(c:APIRequestContext,ws:string,config:Record<string,unknown>,templateKey="PRODUCT_AI_VIDEO_REVIEW_V1"){const r=await c.post(`/api/workspaces/${ws}/workflows`,{data:{name:"Controlled acceptance workflow",templateKey,configuration:config}});expect(r.status(),await r.text()).toBe(201);return (await r.json()).definition as {id:string;versionId:string;versionNumber:number};}
export async function start(c:APIRequestContext,ws:string,id:string,extra:Record<string,unknown>={}){const r=await c.post(`/api/workspaces/${ws}/workflows/${id}/runs`,{data:{idempotencyKey:randomUUID(),...extra}});expect(r.status(),await r.text()).toBe(201);return (await r.json()).run.id as string;}
export async function detail(c:APIRequestContext,ws:string,id:string){const r=await c.get(`/api/workspaces/${ws}/workflows/runs/${id}`,{maxRetries:2});expect(r.status(),await r.text()).toBe(200);return r.json();}
export async function reviewOutputs(c:APIRequestContext,ws:string,id:string,decisions:string[]){const data=await detail(c,ws,id);expect(data.outputs).toHaveLength(decisions.length);for(const [i,o] of data.outputs.entries()){const decision=decisions[i];const r=await c.post(`/api/workspaces/${ws}/content/${o.contentId}/review`,{data:{versionId:o.versionId,expectedRevision:o.reviewRevision,requestKey:randomUUID(),decision,...(decision==="REJECT"?{reasonCategory:"QUALITY_ISSUE"}:{})}});expect(r.status(),await r.text()).toBe(200);}}

export function stressTick(id:string){return JSON.parse(execFileSync(process.execPath,[...args(id,2),"","100"],{env:workflowEnv(),encoding:"utf8",windowsHide:true}));}
export function refundChild(ws:string,operatorId:string,jobId:string){return JSON.parse(execFileSync(process.execPath,["--env-file=.env.local","--import","tsx","tests/invoke-billing.ts","refund",ws,operatorId,jobId,randomUUID(),"Explicit TEST workflow refund policy acceptance"],{env:workflowEnv(),encoding:"utf8",windowsHide:true}));}
export async function claimFixtureWorkerProcess(token:string){
  const child=spawn(process.execPath,["--env-file=.env.local","--import","tsx","tests/invoke-workflow-worker.ts","claim"],{env:{...workflowEnv(),WORKFLOW_FIXTURE_WORKER_TOKEN:token},windowsHide:true,stdio:["ignore","pipe","pipe"]});
  const stop=async()=>{if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;const closed=new Promise<void>(resolve=>child.once("exit",()=>resolve()));child.kill();await closed;};
  try{
    const claim=await new Promise<Claim>((resolve,reject)=>{
      let output="",errors="";const timer=setTimeout(()=>reject(new Error("Fixture worker claim timed out")),20000);
      child.stdout.on("data",data=>{output+=String(data);if(output.includes("\n")){clearTimeout(timer);try{resolve(JSON.parse(output.split("\n")[0]));}catch(error){reject(error);}}});
      child.stderr.on("data",data=>{errors+=String(data);});
      child.once("error",error=>{clearTimeout(timer);reject(error);});
      child.once("exit",code=>{clearTimeout(timer);reject(new Error(`Fixture worker stopped before claiming (${code}): ${errors.slice(-500)}`));});
    });
    return {claim,stop};
  }catch(error){await stop();throw error;}
}
export async function completeFixtureWorkerProcess(ws:string,jobId:string,source:{id:string;sha256:string;byteSize:number}){
  await promisify(execFile)(process.execPath,["--env-file=.env.local","--import","tsx","tests/invoke-workflow-worker.ts","complete",ws,jobId,JSON.stringify(source)],{env:workflowEnv(),windowsHide:true,timeout:60000});
}
