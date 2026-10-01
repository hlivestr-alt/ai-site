export type Environment="local"|"test"|"staging"|"production";
export type ConfigCheck={name:string;status:"configured"|"missing"|"invalid";required:boolean};
const localHost=(url:string)=>{try{return ['localhost','127.0.0.1','::1','[::1]'].includes(new URL(url).hostname);}catch{return false;}};
export function environment(env:Record<string,string|undefined>=process.env):Environment{
  const mode=env.APP_ENV;
  if(!['local','test','staging','production'].includes(mode||''))throw new Error("APP_ENV must be local, test, staging or production");
  return mode as Environment;
}
export function nonProductionTestAllowed(env:Record<string,string|undefined>=process.env){return ['local','test'].includes(env.APP_ENV||'')&&localHost(env.APP_BASE_URL||'');}
export function boundedSetting(name:string,fallback:number,min=1,max=1000000,env:Record<string,string|undefined>=process.env){const value=Number(env[name]||fallback);if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`${name} configuration is invalid`);return value;}
export function configurationChecks(env:Record<string,string|undefined>=process.env,production=false):ConfigCheck[]{
  const mode=env.APP_ENV,strict=production||mode==='production'||mode==='staging',checks:ConfigCheck[]=[];
  const add=(name:string,valid:(value:string)=>boolean,required=true)=>{const v=env[name];checks.push({name,status:!v?'missing':valid(v)?'configured':'invalid',required});};
  add('APP_ENV',v=>production?v==='production':['local','test','staging','production'].includes(v));
  add('APP_BASE_URL',v=>{try{const u=new URL(v);return !u.username&&!u.password&&u.origin===v&&!u.search&&(strict?u.protocol==='https:':['http:','https:'].includes(u.protocol));}catch{return false;}});
  add('DATABASE_URL',v=>{try{return /^postgres(ql)?:$/.test(new URL(v).protocol);}catch{return false;}});
  for(const name of ['OBJECT_STORAGE_BUCKET','OBJECT_STORAGE_REGION','OBJECT_STORAGE_ACCESS_KEY','OBJECT_STORAGE_SECRET_KEY'])add(name,v=>v.length>0);
  add('OBJECT_STORAGE_ENDPOINT',v=>{try{const u=new URL(v);return !u.username&&!u.password&&(strict?u.protocol==='https:':['http:','https:'].includes(u.protocol));}catch{return false;}});
  add('WORKFLOW_MAX_TOKENS',v=>/^\d+$/.test(v)&&BigInt(v)>0&&BigInt(v)<=9007199254740991n,strict);
  const mail=env.MAIL_PROVIDER||(env.MAIL_MODE==='development_file'?'development_file':'');
  checks.push({name:'MAIL_PROVIDER',status:mail&&(strict?mail==='smtp':['smtp','development_file','fake'].includes(mail))?'configured':mail?'invalid':'missing',required:true});
  if(mail==='smtp'){
    for(const name of ['SMTP_HOST','SMTP_USER','SMTP_PASSWORD','MAIL_FROM'])add(name,v=>!!v&&!/[\r\n]/.test(v));
    add('SMTP_PORT',v=>/^\d+$/.test(v)&&Number(v)>0&&Number(v)<=65535);
    add('MAIL_ENCRYPTION_KEY',v=>/^[a-f0-9]{64}$/i.test(v));
  }
  for(const name of ['ENABLE_FAKE_VIDEO_PROVIDER','ENABLE_FAKE_PAYMENT_PROVIDER','ENABLE_FAKE_CLIP_ANALYZER','ENABLE_TEST_BILLING','ENABLE_TEST_MAIL_FAILURE']){
    const value=env[name];checks.push({name,status:value&&value!=='0'&&value!=='1'||value==='1'&&(strict||!nonProductionTestAllowed(env))?'invalid':'configured',required:true});
  }
  for(const [name,real] of [['VIDEO_PROVIDER','byteplus'],['PAYMENT_PROVIDER','xendit']])if(env[name])checks.push({name,status:env[name]===real||env[name]==='fake'&&!strict&&nonProductionTestAllowed(env)?'configured':'invalid',required:true});
  for(const name of ['AI_VIDEO_ENABLED','CLIPPER_ENABLED','WORKFLOWS_ENABLED','PAYMENTS_ENABLED'])if(env[name])checks.push({name,status:['0','1'].includes(env[name]!)?'configured':'invalid',required:true});
  const emails=(env.PLATFORM_OPERATOR_EMAILS||'').split(',').map(v=>v.trim()).filter(Boolean),ids=(env.PLATFORM_OPERATOR_USER_IDS||'').split(',').map(v=>v.trim()).filter(Boolean);
  checks.push({name:'PLATFORM_OPERATOR_ALLOWLIST',status:emails.length+ids.length?emails.every(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))&&ids.every(v=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v))?'configured':'invalid':'missing',required:strict});
  if(env.OPS_READINESS_TOKEN)add('OPS_READINESS_TOKEN',v=>v.length>=32);
  const ranges:Record<string,[number,number]>={DB_POOL_MAX:[1,50],DB_STATEMENT_TIMEOUT_MS:[1000,120000],DB_LOCK_TIMEOUT_MS:[100,30000],DB_IDLE_TRANSACTION_TIMEOUT_MS:[1000,300000],SERVICE_STALE_SECONDS:[10,3600],BACKUP_STALE_HOURS:[1,720],RESTORE_DRILL_STALE_DAYS:[1,365],DISPATCHER_POLL_MS:[200,30000],WORKFLOW_POLL_MS:[200,30000],PROVIDER_MAX_CONCURRENCY:[1,100],PROVIDER_WORKSPACE_CONCURRENCY:[1,100],RATE_LIMIT_WINDOW_SECONDS:[1,86400],PENDING_UPLOAD_RETENTION_HOURS:[1,720]};
  for(const [name,value] of Object.entries(env)){if(!value)continue;const range=ranges[name]||(name.startsWith('QUOTA_')?[1,9007199254740991]:name.startsWith('BATCH_')?[1,100]:name.startsWith('RATE_LIMIT_')?[1,100000]:null);if(range)add(name,v=>Number.isSafeInteger(Number(v))&&Number(v)>=range[0]&&Number(v)<=range[1]);}
  if(strict&&env.DEV_DIAGNOSTIC_TOKEN)checks.push({name:'DEV_DIAGNOSTIC_TOKEN',status:'invalid',required:true});
  if(strict&&env.MAIL_MODE==='development_file')checks.push({name:'MAIL_MODE',status:'invalid',required:true});
  if(strict&&env.ALLOWED_ORIGINS){for(const origin of env.ALLOWED_ORIGINS.split(','))if(origin.trim()!==env.APP_BASE_URL)checks.push({name:'ALLOWED_ORIGINS',status:'invalid',required:true});}
  return checks;
}
export function assertRuntimeConfiguration(){const bad=configurationChecks().filter(c=>c.required&&c.status!=='configured');if(bad.length)throw new Error(`Configuration rejected: ${bad.map(c=>c.name+':'+c.status).join(', ')}`);}
export function externalConfiguration(env:Record<string,string|undefined>=process.env){return {
 bytePlus:!!env.BYTEPLUS_ARK_API_KEY,openAi:!!env.OPENAI_API_KEY||env.OPENAI_WORKER_CREDENTIAL_CONFIGURED==='1',
 xenditSandbox:!!env.XENDIT_SECRET_KEY?.startsWith('xnd_development_')&&!!env.XENDIT_CALLBACK_TOKEN&&!!env.XENDIT_BUSINESS_ID,
 productionMail:env.MAIL_PROVIDER==='smtp'&&!!env.SMTP_HOST&&!!env.SMTP_USER&&!!env.SMTP_PASSWORD&&!!env.MAIL_FROM,
 productionStorage:!!env.OBJECT_STORAGE_BUCKET&&!!env.OBJECT_STORAGE_ACCESS_KEY&&!!env.OBJECT_STORAGE_SECRET_KEY&&!!env.OBJECT_STORAGE_ENDPOINT?.startsWith('https:')&&!localHost(env.OBJECT_STORAGE_ENDPOINT),
};}
export function featureEnabled(name:'AI_VIDEO'|'CLIPPER'|'WORKFLOWS'|'PAYMENTS'){return process.env[`${name}_ENABLED`]!=='0';}
export function clipperConfigured(){return featureEnabled('CLIPPER')&&(nonProductionTestAllowed()&&process.env.ENABLE_FAKE_CLIP_ANALYZER==='1'||process.env.CLIPPER_ANALYZER_CONFIGURED==='1');}
