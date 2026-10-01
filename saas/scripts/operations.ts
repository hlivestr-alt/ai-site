import {query,pool} from '../src/lib/db';
import {readiness,operationStatus,operationalAudits,storageAudit,operatorAction,isOperator} from '../src/lib/operations';
import {configurationChecks,externalConfiguration,boundedSetting} from '../src/lib/operational-config';
import type {Session} from '../src/lib/auth';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseEnv} from 'node:util';
async function externalPreflight(){
  const configured=externalConfiguration();
  // The analyzer credential belongs to the private worker, not the web process.
  const paths=process.env.PRIVATE_WORKER_ENV_FILE?[resolve(process.env.PRIVATE_WORKER_ENV_FILE)]:[resolve('../worker-agent/.env'),resolve('../worker-agent/.env.local')];
  for(const path of paths)try{const worker=parseEnv(await readFile(path,'utf8'));if(worker.CLIP_ANALYZER_PROVIDER==='openai'&&worker.OPENAI_API_KEY&&worker.OPENAI_CLIP_MODEL)configured.openAi=true;}catch{}
  return configured;
}
async function main(){
  const [command='status',arg]=process.argv.slice(2);
  if(command==='external-preflight'){console.log(JSON.stringify(await externalPreflight(),null,2));return;}
  if(command==='production-preflight'){
    const config=configurationChecks(process.env,true),ready=await readiness();
    let pricing={aiVideo:false,clipper:false,packages:false};
    if(ready.checks.database==='READY'&&ready.checks.migrations==='READY'){
    const prices=(await query<{operation:string;label:string;rules:Record<string,unknown>}>("SELECT c.operation,v.label,v.rules FROM price_catalogs c JOIN price_versions v ON v.id=c.active_version_id AND v.catalog_id=c.id WHERE c.realm='PRODUCTION'")).rows;
    const packages=(await query<{label:string;token_amount:string;fiat_minor:string}>("SELECT v.label,v.token_amount,v.fiat_minor FROM token_packages p JOIN token_package_versions v ON v.id=p.active_version_id AND v.package_id=p.id WHERE p.realm='PRODUCTION'")).rows;
    pricing={aiVideo:prices.some(p=>p.operation==='AI_VIDEO'&&!/^TEST/i.test(p.label)&&p.rules.tier==='QUALITY'&&BigInt(String(p.rules.perSecond||0))>0n),clipper:prices.some(p=>p.operation==='CLIPPER'&&!/^TEST/i.test(p.label)&&BigInt(String(p.rules.base||0))>0n),packages:packages.length>0&&packages.every(p=>!/^TEST/i.test(p.label)&&BigInt(p.token_amount)>0n&&BigInt(p.fiat_minor)>0n)};
    }
    const status=await operationStatus(),external=await externalPreflight(),checks={configuration:config.every(c=>!c.required||c.status==='configured'),infrastructure:ready.ready,pricing:Object.values(pricing).every(Boolean),executionDispatcher:status.services.some(s=>s.service==='execution_dispatcher'&&s.status==='HEALTHY'),workflowDispatcher:status.services.some(s=>s.service==='workflow_dispatcher'&&s.status==='HEALTHY'),worker:status.workers.some(w=>w.status==='ACTIVE'&&w.capabilities.includes('CLIPPER_V1')&&w.max_concurrency===1&&w.freshness==='ONLINE'&&!w.diskPressure&&w.clipper_health.transcriberAvailable===true&&w.clipper_health.ffmpegAvailable===true&&w.clipper_health.gpuAvailable===true),restoreDrill:!!status.lastRestoreVerifiedAt&&Date.now()-new Date(status.lastRestoreVerifiedAt).getTime()<boundedSetting('RESTORE_DRILL_STALE_DAYS',30,1,365)*86400000,backupFresh:!!status.backup&&!status.alerts.some(a=>a.code==='BACKUP_STALE'),accounting:status.billingMismatchCount===0,externalCredentials:Object.values(external).every(Boolean),bytePlusAccepted:process.env.BYTEPLUS_ACCEPTANCE_VERIFIED==='1',openAiAccepted:process.env.OPENAI_ACCEPTANCE_VERIFIED==='1',xenditSandboxAccepted:process.env.XENDIT_SANDBOX_ACCEPTANCE_VERIFIED==='1',featuresEnabled:Object.values(status.features).every(Boolean),publicHttps:process.env.APP_BASE_URL?.startsWith('https://')===true,supervisionAttested:process.env.PRODUCTION_SUPERVISION_VERIFIED==='1',storagePrivacyAttested:process.env.PRODUCTION_STORAGE_VERIFIED==='1',productionMailAccepted:process.env.PRODUCTION_MAIL_VERIFIED==='1',callbackAccepted:process.env.PUBLIC_CALLBACKS_VERIFIED==='1'};
    const passed=Object.values(checks).every(Boolean);console.log(JSON.stringify({ready:passed,checks,configuration:config,pricing,external},null,2));if(!passed)process.exitCode=2;return;
  }
  if(command==='readiness'){const r=await readiness();console.log(JSON.stringify(r));if(!r.ready)process.exitCode=2;return;}
  if(command==='status'){console.log(JSON.stringify(await operationStatus(),null,2));return;}
  if(command==='audit'){console.log(JSON.stringify(await operationalAudits(),null,2));return;}
  if(command==='storage-audit'){console.log(JSON.stringify(await storageAudit(arg,Number(process.argv[4]||100)),null,2));return;}
  if(command==='action'){
    const actor=process.env.OPERATOR_USER_ID;if(!actor)throw new Error('Explicit operator identity required');const user=(await query<{id:string;email:string}>("SELECT id,email FROM users WHERE id=$1 AND status='ACTIVE'",[actor])).rows[0];if(!user||!isOperator({userId:user.id,email:user.email}))throw new Error('Allowlisted active operator required');
    const {readFile}=await import('node:fs/promises');const raw=await readFile(arg,'utf8');if(raw.length>16384)throw new Error('Action input too large');console.log(JSON.stringify(await operatorAction({userId:user.id,email:user.email} as Session,JSON.parse(raw))));return;
  }
  throw new Error('Usage: operations.ts status|readiness|audit|storage-audit workspaceId [limit]|external-preflight|production-preflight|action file.json');
}
main().catch(()=>{console.error(JSON.stringify({code:'OPERATIONS_COMMAND_UNAVAILABLE'}));process.exitCode=1;}).finally(()=>pool().end());
