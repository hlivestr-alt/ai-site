// Public HTTPS smoke only: no accounts, mail, inference, Outreach or payments.
import {chromium} from '@playwright/test';
import {randomBytes} from 'node:crypto';
import {writeFile,appendFile} from 'node:fs/promises';
import {configuredSecrets,scanText} from '../stabilization/secret-audit.mjs';
const origin='https://ai-test.proyaofficial.com',secrets=await configuredSecrets(),results=[];
async function bounded(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('PUBLIC_READ_TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}}
async function progress(value){await appendFile('.next-tests/phase-e/remote-progress.log',JSON.stringify(value)+'\n');}
let failed=false;
for(const channel of ['chrome','msedge']){
 let browser,context;try{browser=await chromium.launch({channel,timeout:20000});context=await browser.newContext();}catch{failed=true;results.push({channel,status:'FAIL',code:'PUBLIC_BROWSER_LAUNCH_FAILED'});await browser?.close().catch(()=>{});continue;}
 const page=await context.newPage(),leaks=[],crashes=[],reads=[];
 context.setDefaultTimeout(15000);context.setDefaultNavigationTimeout(15000);
 page.on('pageerror',()=>crashes.push('BROWSER_PAGE_ERROR'));
 page.on('console',m=>{for(const category of scanText(m.text(),secrets))leaks.push({source:'console',category});});
 page.on('response',r=>{if(r.url().startsWith(origin)&&/json|html|javascript|text\//.test(r.headers()['content-type']||''))reads.push(bounded(r.text(),5000).then(t=>{for(const category of scanText(t,secrets))leaks.push({source:'response',category});}).catch(()=>{}));});
 const checks=[];
 try{
  for(const path of ['/login','/register','/forgot-password']){const response=await page.goto(origin+path,{waitUntil:'domcontentloaded'});const body=await page.locator('body').innerText();checks.push({path,status:response.status(),localMailboxWording:/local development mailbox/i.test(body)});await progress({channel,path,status:response.status()});}
  for(const path of ['/verify','/reset-password']){const marker=randomBytes(32).toString('hex'),response=await context.request.get(origin+path+'?token='+marker,{timeout:15000}),text=await bounded(response.text(),5000);checks.push({path,status:response.status(),markerInHTML:text.includes(marker)});for(const category of scanText(text,secrets))leaks.push({source:'auth-html',category});await progress({channel,path,status:response.status()});}
  await Promise.allSettled(reads);const pass=checks.every(c=>c.status===200&&!c.localMailboxWording&&!c.markerInHTML)&&leaks.length===0&&crashes.length===0;failed||=!pass;results.push({channel,browserVersion:browser.version(),status:pass?'PASS':'FAIL',checks,secretLeaks:leaks,pageErrors:crashes});
 }catch{failed=true;results.push({channel,status:'FAIL',code:'PUBLIC_HTTPS_SMOKE_FAILED'});}
 finally{await context.close();await browser.close();}
}
const health=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(15000)}).then(r=>r.status).catch(()=>0);failed||=health!==200;
const result={status:failed?'FAIL':'PASS',healthStatus:health,results,remoteDataMutations:0,realEmails:0,paid:{realVideo:0,realLLM:0,outreach:0,payments:0}};
await writeFile('docs/phase-e-evidence/remote-public.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=failed?1:0;
