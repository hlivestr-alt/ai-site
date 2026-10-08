import 'server-only';
import {randomUUID} from 'node:crypto';
import {query,transaction,type DbClient} from './db';
import type {Session} from './auth';
import {requestSession} from './http';
import {requireActiveWorkspace} from './products';
import {AppError} from './core';
import {digest,opaque,isOpaque,isDigest,recordMac,validRecord,boundedCallback,verifyHandoff,signHandoff,REGISTER_PATH,COMPLETE_PATH,ROUTER_COOKIE,canonicalBody,type RouterRecord} from './outreach-oauth-core';
const key=()=>process.env.OUTREACH_OAUTH_ROUTER_KEY || '';
const handoffKey=()=>process.env.OUTREACH_NATIVE_HANDOFF_KEY || '';
export function initiationEnabled(){if(process.env.OUTREACH_OAUTH_INITIATIONS_ENABLED==='0')throw new AppError(503,'Account connections are temporarily unavailable.');}
export async function verifyAuthorizationSession(db:DbClient,session:Session,w:string) {
  if(!(await db.query('SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.active_workspace_id=$3 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status=\'ACTIVE\' FOR UPDATE OF s',[session.id,session.userId,w])).rowCount)throw new AppError(400,'Authorization session changed.');
}
export async function registerSaasRouterState(db:DbClient,session:Session,w:string,channel:string,state:string,expires:Date) {
  initiationEnabled();
  // First-workspace sessions historically have a null selection. Materialize
  // the already permission-checked choice so this operation has an exact binding.
  if((await db.query('UPDATE sessions SET active_workspace_id=$1 WHERE id=$2 AND user_id=$3 AND revoked_at IS NULL AND expires_at>now() AND (active_workspace_id IS NULL OR active_workspace_id=$1) RETURNING id',[w,session.id,session.userId])).rowCount!==1)throw new AppError(403,'Authorization session changed. Sign in again.');
  const r:RouterRecord={state_hash:digest(state),flow_kind:'SAAS',operation_id:randomUUID(),created_at:new Date(),expires_at:expires,consumed_at:null,workspace_id:w,channel_id:channel,actor_id:session.userId,session_id:session.id,native_issuer:null,native_browser_hash:null,completion_identity:null,ticket_hash:null,browser_hash:null,bound_at:null,integrity_mac:''};
  r.integrity_mac=recordMac(r,key());
  await db.query('INSERT INTO outreach_oauth_router_states(state_hash,flow_kind,operation_id,created_at,expires_at,workspace_id,channel_id,actor_id,session_id,saas_state_hash,integrity_mac) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$1,$10)',[r.state_hash,r.flow_kind,r.operation_id,r.created_at,r.expires_at,w,channel,session.userId,session.id,r.integrity_mac]);
}
async function locked(db:DbClient,state:string) {
  if(!isOpaque(state))throw new Error('OAUTH_STATE_REJECTED');
  const row=(await db.query<RouterRecord>('SELECT * FROM outreach_oauth_router_states WHERE state_hash=$1 FOR UPDATE',[digest(state)])).rows[0];
  if(!row)throw new Error('OAUTH_STATE_REJECTED');return validRecord(row,key());
}
async function consume(db:DbClient,r:RouterRecord) {
  r.consumed_at=new Date();r.integrity_mac=recordMac(r,key());
  if((await db.query('UPDATE outreach_oauth_router_states SET consumed_at=$1,integrity_mac=$2 WHERE state_hash=$3 AND consumed_at IS NULL AND expires_at>now()',[r.consumed_at,r.integrity_mac,r.state_hash])).rowCount!==1)throw new Error('OAUTH_STATE_REJECTED');
}
export async function consumeSaasRouterState(session:Session,state:string) {
  try {await transaction(async db=>{const r=await locked(db,state);if(r.flow_kind!=='SAAS'||r.actor_id!==session.userId||r.session_id!==session.id||r.workspace_id!==session.activeWorkspaceId)throw new AppError(400,'Authorization belongs to another session.');
    await requireActiveWorkspace(session,r.workspace_id!,'outreach:channel_manage',db);
    await verifyAuthorizationSession(db,session,r.workspace_id!);
    const legacy=(await db.query('SELECT 1 FROM outreach_oauth_states s JOIN outreach_channels c ON c.workspace_id=s.workspace_id AND c.id=s.channel_id WHERE s.state_hash=$1 AND s.workspace_id=$2 AND s.channel_id=$3 AND s.actor_id=$4 AND s.session_id=$5 AND s.finished_at IS NULL AND s.consumed_at IS NULL AND s.expires_at>now() AND c.authorization_state_hash=s.state_hash AND c.status=\'PENDING\'',[r.state_hash,r.workspace_id,r.channel_id,r.actor_id,r.session_id])).rowCount;
    if(!legacy)throw new AppError(400,'Authorization expired or was superseded.');await consume(db,r);
  });}catch(error){if(error instanceof AppError)throw error;throw new AppError(400,'Authorization could not be verified. Start a new connection.');}
}
export async function registerNative(body:unknown,headers:Headers) {
  initiationEnabled();
  const b=body as Record<string,unknown>;
  if(!b||Object.keys(b).sort().join(',')!=='browserHash,expiresAt,operationId,stateHash,ticketHash'||!isDigest(b.stateHash)||!isDigest(b.browserHash)||!isDigest(b.ticketHash)||typeof b.operationId!=='string'||!/^[0-9a-f-]{36}$/.test(b.operationId)||typeof b.expiresAt!=='string')throw new Error('OAUTH_REGISTRATION_REJECTED');
  const expires=new Date(b.expiresAt),created=new Date();
  if(!Number.isFinite(expires.getTime())||expires.getTime()<=created.getTime()||expires.getTime()>created.getTime()+600000)throw new Error('OAUTH_REGISTRATION_REJECTED');
  const proof=verifyHandoff(handoffKey(),REGISTER_PATH,b,headers);
  await transaction(async db=>{
    await db.query('INSERT INTO outreach_oauth_handoff_nonces(nonce_hash,expires_at) VALUES($1,$2)',[proof.nonceHash,proof.expiresAt]);
    const r:RouterRecord={state_hash:b.stateHash as string,flow_kind:'NATIVE',operation_id:b.operationId as string,created_at:created,expires_at:expires,consumed_at:null,workspace_id:null,channel_id:null,actor_id:null,session_id:null,native_issuer:'NATIVE_OPERATOR_V1',native_browser_hash:b.browserHash as string,completion_identity:'NATIVE_PRIVATE_V1',ticket_hash:b.ticketHash as string,browser_hash:null,bound_at:null,integrity_mac:''};
    r.integrity_mac=recordMac(r,key());
    await db.query("INSERT INTO outreach_oauth_router_states(state_hash,flow_kind,operation_id,created_at,expires_at,native_issuer,native_browser_hash,completion_identity,ticket_hash,integrity_mac) VALUES($1,'NATIVE',$2,$3,$4,$5,$6,$7,$8,$9)",[r.state_hash,r.operation_id,r.created_at,r.expires_at,r.native_issuer,r.native_browser_hash,r.completion_identity,r.ticket_hash,r.integrity_mac]);
  });
}
export function cookie(request:Request,name:string) {return (request.headers.get('cookie')||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(name+'='))?.slice(name.length+1);}
export async function bindNativeBrowser(request:Request,state:string,ticket:string) {
  initiationEnabled();
  if(request.headers.get('origin')!==process.env.OUTREACH_NATIVE_OPERATOR_ORIGIN||!isOpaque(ticket))throw new Error('OAUTH_BROWSER_REJECTED');
  const existing=cookie(request,ROUTER_COOKIE),raw=isOpaque(existing)?existing:opaque();
  await transaction(async db=>{const r=await locked(db,state);if(r.flow_kind!=='NATIVE'||r.bound_at||r.browser_hash||r.ticket_hash!==digest(ticket))throw new Error('OAUTH_BROWSER_REJECTED');
    r.browser_hash=digest(raw);r.bound_at=new Date();r.integrity_mac=recordMac(r,key());
    await db.query('UPDATE outreach_oauth_router_states SET browser_hash=$1,bound_at=$2,integrity_mac=$3 WHERE state_hash=$4',[r.browser_hash,r.bound_at,r.integrity_mac,r.state_hash]);
  });return raw;
}
function completionUrl() {
  const u=new URL(process.env.OUTREACH_NATIVE_COMPLETION_ORIGIN || 'http://127.0.0.1:4000');
  if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('OAUTH_NATIVE_ROUTE_UNAVAILABLE');
  return new URL(COMPLETE_PATH,u);
}
export type CallbackResult='saas-success'|'saas-failure'|'native-success'|'native-failure'|'failure';
export async function routeCallback(request:Request):Promise<CallbackResult> {
  let flow:RouterRecord['flow_kind']|undefined;
  try {
    const {state,code}=boundedCallback(new URL(request.url));
    const candidate=(await query<RouterRecord>('SELECT * FROM outreach_oauth_router_states WHERE state_hash=$1',[digest(state)])).rows[0];
    if(!candidate)throw new Error('OAUTH_STATE_REJECTED');validRecord(candidate,key());flow=candidate.flow_kind;
    if(flow==='SAAS') {const session=await requestSession(request);const {authorizationCallback}=await import('./outreach-provider');await authorizationCallback(session,state,code);return 'saas-success';}
    if(flow!=='NATIVE')throw new Error('OAUTH_STATE_REJECTED');
    const r=await transaction(async db=>{const row=await locked(db,state),browser=cookie(request,ROUTER_COOKIE);if(row.flow_kind!=='NATIVE'||row.native_issuer!=='NATIVE_OPERATOR_V1'||row.completion_identity!=='NATIVE_PRIVATE_V1'||!row.bound_at||!isOpaque(browser)||row.browser_hash!==digest(browser))throw new Error('OAUTH_BROWSER_REJECTED');await consume(db,row);return row;});
    const body={state,code,operationId:r.operation_id,browserHash:r.native_browser_hash};
    const response=await fetch(completionUrl(),{method:'POST',headers:{'content-type':'application/json',...signHandoff(handoffKey(),COMPLETE_PATH,body)},body:canonicalBody(body),redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'});
    // Native returns a fixed 204 only after its own encrypted persistence; never relay its body.
    if(response.status!==204)throw new Error('OAUTH_NATIVE_COMPLETION_FAILED');return 'native-success';
  } catch {return flow==='NATIVE'?'native-failure':flow==='SAAS'?'saas-failure':'failure';}
}
