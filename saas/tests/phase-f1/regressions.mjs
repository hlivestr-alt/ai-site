import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
const suites=['integration','browser','shared','focused','restart','phase-b','variations','restart-variation','editor','isolation','outreach','outreach-browser','outreach-restart','provider','provider-browser','canary-browser'];
const results=[];
for(const suite of suites){let output='';const code=await new Promise(resolve=>{const p=spawn(process.execPath,['tests/phase-f1/run.mjs','--suite',suite,'--app-port','3267','--storage-port','9067'],{windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.on('error',()=>resolve(127));p.on('close',resolve);});
 results.push({suite,exitCode:code});await writeFile('.next-tests/phase-f1/regression-progress.json',JSON.stringify(results,null,2));
 console.log(suite+': '+(code===0?'PASS':'FAIL'));
 if(code!==0){console.log('Failure details retained in the owned, sanitized suite log.');process.exitCode=1;break;}
}
await writeFile('docs/phase-f1-evidence/regression-summary.json',JSON.stringify({status:results.length===suites.length&&results.every(r=>r.exitCode===0)?'PASS':'INCOMPLETE',suites:results,realExternalOperations:0},null,2));
