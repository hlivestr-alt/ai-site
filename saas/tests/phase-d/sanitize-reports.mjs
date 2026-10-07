// Upgrade only this runner's owned, ignored reports without emitting their content.
import {readFile,readdir,writeFile} from 'node:fs/promises';
for(const dir of await readdir('test-data/phase-d',{withFileTypes:true})){if(!dir.isDirectory())continue;const file=`test-data/phase-d/${dir.name}/playwright.json`;let old;try{old=JSON.parse(await readFile(file,'utf8'));}catch{continue;}if(!old.config)continue;
 const tests=[];function visit(s){for(const spec of s.specs||[])for(const t of spec.tests||[])for(const r of t.results||[])tests.push({title:spec.title,status:r.status,expectedStatus:t.expectedStatus,duration:r.duration,retry:r.retry});for(const child of s.suites||[])visit(child);}for(const suite of old.suites||[])visit(suite);
 await writeFile(file,JSON.stringify({status:old.stats?.unexpected?'failed':'passed',stats:old.stats,tests},null,2));
}
async function sanitizeLogs(dir){for(const f of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const file=`${dir}/${f.name}`;if(f.isDirectory())await sanitizeLogs(file);else if(/\.(log|md)$/.test(f.name)){const text=await readFile(file,'utf8'),safe=text.replace(/\bsaas_session=[A-Za-z0-9_-]{32,}/g,'saas_session=[SESSION_COOKIE]');if(text!==safe)await writeFile(file,safe);}}}
await sanitizeLogs('test-data/phase-d');
await sanitizeLogs('test-results');
