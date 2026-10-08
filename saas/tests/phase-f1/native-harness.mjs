import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const native='C:/Data/TikTok Outreach';
export async function nativeHarness(admin,env,runId) {
 const name='phase_e_native_'+runId,url=new URL(env.DATABASE_URL);url.pathname='/'+name;
 await admin.query('CREATE DATABASE "'+name+'"');
 const apiPort=4351,webPort=3351,nativeEnv={...env,DATABASE_URL:url.href,RUNTIME_ENV:'test',SERVICE_ROLE:'api',APP_MODE:'read_only',OUTBOUND_MODE:'read_only',PORT:String(apiPort),HOST:'127.0.0.1',NATIVE_PROJECT_ROOT:native,TIKTOK_APP_KEY:'controlled_native_app',TIKTOK_APP_SECRET:'controlled_native_app_secret',TIKTOK_SERVICE_ID:'controlled_native_service',TIKTOK_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64'),TIKTOK_AUTH_BASE_URL:'https://auth.example.test',TIKTOK_API_BASE_URL:'https://api.example.test',TIKTOK_CATEGORY_APP_KEY:'',TIKTOK_CATEGORY_APP_SECRET:'',TIKTOK_CATEGORY_ACCESS_TOKEN:'',TIKTOK_CATEGORY_SHOP_CIPHER:'',TIKTOK_OAUTH_ROUTER_ENABLED:'1',TIKTOK_OAUTH_ROUTER_ORIGIN:env.APP_BASE_URL,TIKTOK_OAUTH_HANDOFF_KEY:env.OUTREACH_NATIVE_HANDOFF_KEY,TIKTOK_OAUTH_OPERATOR_ORIGIN:'http://127.0.0.1:'+webPort,FIXTURE_NATIVE_ACCESS:'controlled_native_access_'+randomBytes(12).toString('hex'),FIXTURE_NATIVE_REFRESH:'controlled_native_refresh_'+randomBytes(12).toString('hex'),FIXTURE_NATIVE_CIPHER:'controlled_native_cipher_'+randomBytes(12).toString('hex')};
 Object.assign(env,{OUTREACH_NATIVE_COMPLETION_ORIGIN:'http://127.0.0.1:'+apiPort,OUTREACH_NATIVE_OPERATOR_ORIGIN:nativeEnv.TIKTOK_OAUTH_OPERATOR_ORIGIN,F1_NATIVE_DATABASE_URL:url.href,F1_NATIVE_API_URL:'http://127.0.0.1:'+apiPort,F1_NATIVE_WEB_URL:nativeEnv.TIKTOK_OAUTH_OPERATOR_ORIGIN,F1_NATIVE_ENCRYPTION_KEY:nativeEnv.TIKTOK_TOKEN_ENCRYPTION_KEY,F1_NATIVE_EXPECTED_ACCESS:nativeEnv.FIXTURE_NATIVE_ACCESS});
 const children=[],captures=[];let done=false;const originals=new Map();
 async function execute(label,args,cwd,extra={}){let output='';const status=await new Promise(resolve=>{const p=spawn('cmd.exe',['/d','/c','pnpm',...args],{cwd,env:{...nativeEnv,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']});p.stdout.on('data',v=>output+=v);p.stderr.on('data',v=>output+=v);p.on('error',()=>resolve(127));p.on('close',resolve);});
  const safe=output.replaceAll(nativeEnv.TIKTOK_TOKEN_ENCRYPTION_KEY,'[PRIVATE_KEY]').replaceAll(url.password,'[DATABASE_PASSWORD]');await writeFile('test-data/phase-f1/'+env.STABILIZATION_SUITE+'/'+label+'.log',safe);console.log(label+': exit '+status);if(status!==0)throw new Error('NATIVE_FIXTURE_CHECK_FAILED');return {label,exitCode:status};}
 const cleanup=async()=>{for(const child of children)if(child.pid&&child.exitCode===null)await new Promise(resolve=>{const p=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});p.on('close',resolve);p.on('error',resolve);});for(const [path,bytes] of originals)await writeFile(path,bytes);await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');done=true;};
 try {
  for(const path of [native+'/apps/web/next-env.d.ts',native+'/apps/web/tsconfig.json'])originals.set(path,await readFile(path));
  const checks=[];checks.push(await execute('native-migration',['exec','prisma','migrate','deploy','--schema','packages/db/prisma/schema.prisma'],native));
  checks.push(await execute('native-api-build',['--filter','@affiliate/api','build'],native));
  if(env.STABILIZATION_SUITE==='router') {
   checks.push(await execute('native-unit',['exec','vitest','run','--exclude','**/*.integration.test.ts','--exclude','**/real-read-only.test.ts'],native));
   checks.push(await execute('native-oauth-regression',['exec','vitest','run','apps/api/src/integrations/tiktok-refresh.integration.test.ts','apps/api/src/identity/creator-identity-resolver.integration.test.ts'],native));
  }
  const launch=(args,cwd,extra={})=>{let output='';const child=spawn(process.execPath,args,{cwd,env:{...nativeEnv,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);children.push(child);captures.push(()=>output);return child;};
  launch(['tests/phase-f1/native-fixture.mjs'],process.cwd());
  launch(['node_modules/next/dist/bin/next','dev','-p',String(webPort),'-H','127.0.0.1'],native+'/apps/web',{OUTREACH_QA_PROXY_TARGET:env.F1_NATIVE_API_URL,OUTREACH_QA_DIST_DIR:'.next/phase-f1-fixture',NEXT_PUBLIC_API_URL:'/api/v1'});
  for(const base of [env.F1_NATIVE_API_URL+'/fixture/health',env.F1_NATIVE_WEB_URL+'/settings']){let ready=false;for(let i=0;i<180;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}if(!ready)throw new Error('NATIVE_FIXTURE_NOT_READY');}
  return {checks,cleanup,logs:()=>captures.map(f=>f()).join('\n'),name};
 }catch {if(!done)await cleanup();throw new Error('NATIVE_FIXTURE_NOT_READY');}
}
