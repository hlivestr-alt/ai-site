// Read-only by default; findings contain categories and paths, never matched text.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {configuredSecrets,scanText} from '../stabilization/secret-audit.mjs';
const root=resolve('..'),secrets=await configuredSecrets(),findings=[];
const files=execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root,encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
const staged=execFileSync('git',['diff','--cached','--name-only','-z'],{cwd:root,encoding:'utf8',windowsHide:true}).split('\0').filter(Boolean);
let inspected=0,binaries=0,logs=0;
function decode(bytes){if(bytes[0]===255&&bytes[1]===254)return bytes.subarray(2).toString('utf16le');if(bytes.includes(0))return null;return bytes.toString('utf8');}
function scan(source,file,text){for(const category of scanText(text,secrets))findings.push({source,file,category});if(/\bsaas_session=[A-Za-z0-9_-]{32,}/.test(text))findings.push({source,file,category:'SESSION_COOKIE'});if(/https?:\/\/[^\s"'<>`\\]*\/(?:verify|reset-password)\?[^\s"'<>`\\]*token=[A-Za-z0-9_-]{32,}/i.test(text))findings.push({source,file,category:'COMPLETE_AUTH_LINK'});}
for(const file of [...new Set(files)]){const bytes=await readFile(resolve(root,file)).catch(()=>null);if(!bytes||bytes.length>10000000)continue;const text=decode(bytes);if(text===null){binaries++;continue;}inspected++;scan('working-tree',file,text);if(/(^|\/)\.env(?:\.|$)/.test(file)&&!file.endsWith('.env.example'))findings.push({source:'working-tree',file,category:'TRACKED_ENV'});}
for(const file of staged){const bytes=execFileSync('git',['show',`:${file}`],{cwd:root,windowsHide:true}),text=decode(bytes);if(text!==null)scan('staged-index',file,text);}
async function walk(dir){for(const f of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const path=resolve(dir,f.name);if(f.isDirectory())await walk(path);else if(/\.(?:log|json|md)$/.test(f.name)){const bytes=await readFile(path);if(bytes.length>20000000)continue;const text=decode(bytes);if(text!==null){logs++;scan('isolated-test-output',relative(root,path).replaceAll('\\','/'),text);}}}}
await walk('test-data/phase-c');
await walk('test-results');
for(const dir of await readdir('.next-tests',{withFileTypes:true}))if(dir.isDirectory()&&/^phase-c-\d+$/.test(dir.name))await walk(`.next-tests/${dir.name}/dev/logs`);
for(const file of ['.next-tests/phase-c/runtime.log','.next-tests/phase-b/smtp-runtime.log']){const b=await readFile(file).catch(()=>null);if(b){const text=decode(b);if(text!==null){logs++;scan('saas-runtime',file,text);}}}
const preserved=JSON.parse(await readFile('.next-tests/phase-c/preserved-original-evidence.json','utf8'));let changedEvidence=0;for(const f of preserved)if(createHash('sha256').update(await readFile(f.path)).digest('hex')!==f.sha256)changedEvidence++;
let privateConfigurationIgnored=true;for(const file of ['saas/.env.local','worker-agent/.env'])try{execFileSync('git',['check-ignore','-q',file],{cwd:root,windowsHide:true});}catch{privateConfigurationIgnored=false;}
const result={status:findings.length||changedEvidence||!privateConfigurationIgnored?'FAIL':'PASS',inspectedTextFiles:inspected,excludedBinaryFiles:binaries,stagedFiles:staged.length,scannedLogAndTestOutputFiles:logs,originalEvidenceFiles:preserved.length,changedOriginalEvidenceFiles:changedEvidence,privateConfigurationIgnored,findings};
if(process.argv.includes('--write'))await writeFile('docs/phase-c-evidence/secret-audit.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exitCode=result.status==='PASS'?0:1;
