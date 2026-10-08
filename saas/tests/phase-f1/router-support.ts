import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {request,type APIRequestContext} from '@playwright/test';
import {fixture,close,evidence,type Fixture} from './support';
export {fixture,close,evidence,type Fixture};
export const base=process.env.SAAS_TEST_BASE_URL!;
export const nativeApi=process.env.F1_NATIVE_API_URL!,nativeWeb=process.env.F1_NATIVE_WEB_URL!;
export const marker=()=>['OAUTH','CODE','MUST','NOT','APPEAR'].join('_')+'_'+randomBytes(16).toString('hex');
export const stateMarker=()=>['STATE','MUST','NOT','APPEAR'].join('_')+'_'+randomBytes(16).toString('hex').slice(0,21);
export async function nativeDb(){const d=new pg.Client({connectionString:process.env.F1_NATIVE_DATABASE_URL});await d.connect();return d;}
export async function nativeSnapshot(){const d=await nativeDb();try{return JSON.stringify((await d.query('SELECT "shopId","accessTokenCiphertext","refreshTokenCiphertext","tokenVersion",status FROM "IntegrationConnection" ORDER BY id')).rows);}finally{await d.end();}}
export async function saasSnapshot(f:Fixture){return JSON.stringify((await f.db.query('SELECT credential_id,status,version FROM outreach_credential_versions ORDER BY credential_id')).rows);}
export async function pending(f:Fixture,scenario='VALID') {
 const r=await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/channels`,{data:{provider:'TIKTOK_SHOP',label:'Router controlled fixture'}});if(r.status()!==201)throw new Error('FIXTURE_CHANNEL_CREATE_FAILED');const c=(await r.json()).channel;
 await f.db.query('INSERT INTO outreach_provider_fixtures(workspace_id,channel_id,external_identity,scenario) VALUES($1,$2,$3,$4)',[f.workspaceId,c.id,'router_controlled_'+c.id,scenario]);
 const s=await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/channels/${c.id}/authorization`,{data:{action:'authorize'}});if(s.status()!==200)throw new Error('FIXTURE_SAAS_INITIATION_FAILED');const dto=await s.json();return {channel:c,state:new URL(dto.authorizationUrl).searchParams.get('state')!};
}
export async function nativeInit(context?:APIRequestContext){const c=context||await request.newContext({baseURL:nativeApi,extraHTTPHeaders:{Origin:nativeWeb}}),r=await c.post('/api/v1/integrations/tiktok/authorize',{data:{}});if(r.status()!==201&&r.status()!==200)throw new Error('FIXTURE_NATIVE_INITIATION_FAILED');return {c,...await r.json()};}
export async function bind(c:APIRequestContext,state:string,ticket:string,origin=nativeWeb) {return c.post(base+'/api/outreach/tiktok/native/start',{form:{state,ticket},headers:{Origin:origin},maxRedirects:0});}
export async function callback(c:APIRequestContext,state:string,code=marker(),extra=''){return c.get(base+'/api/outreach/tiktok/callback?'+new URLSearchParams({state,code}).toString()+extra,{maxRedirects:0});}
export async function invoke(input:Record<string,unknown>){return new Promise<{rejected?:boolean;expired?:boolean;rewritten?:boolean}>((resolve,reject)=>{let out='';const p=spawn(process.execPath,['--conditions=react-server','--import','tsx','tests/phase-f1/router-invoke.ts'],{env:process.env,windowsHide:true,stdio:['pipe','pipe','pipe']});p.stdout.on('data',b=>out+=b);p.stderr.on('data',()=>{});p.on('close',code=>{if(code)reject(new Error('FIXTURE_PRIVATE_ACTION_FAILED'));else try{resolve(JSON.parse(out));}catch{reject(new Error('FIXTURE_PRIVATE_ACTION_FAILED'));}});p.on('error',()=>reject(new Error('FIXTURE_PRIVATE_ACTION_FAILED')));p.stdin.end(JSON.stringify(input));});}
