import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

export const REGISTER_PATH = '/api/outreach/tiktok/native/register';
export const COMPLETE_PATH = '/api/v1/integrations/tiktok/private-completion';
export const NATIVE_START_PATH = '/api/outreach/tiktok/native/start';
export const ROUTER_COOKIE = 'outreach_oauth_browser';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const opaque = () => randomBytes(32).toString('base64url');
export const isOpaque = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function equalDigest(a: string, b: string) {return isDigest(a) && isDigest(b) && timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
export function canonicalBody(value: unknown): string {
  if(value === null || typeof value !== 'object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonicalBody).join(',')+']';
  const object=value as Record<string,unknown>;
  return '{'+Object.keys(object).sort().map(k=>JSON.stringify(k)+':'+canonicalBody(object[k])).join(',')+'}';
}
export function privateKey(value: string | undefined) {if(!isDigest(value))throw new Error('OAUTH_PRIVATE_CONFIGURATION_UNAVAILABLE');return Buffer.from(value,'hex');}
function signature(key: string, path: string, timestamp: string, nonce: string, body: unknown) {
  return createHmac('sha256',privateKey(key)).update(canonicalBody(['OUTREACH_PRIVATE_HANDOFF_V1','POST',path,timestamp,nonce,digest(canonicalBody(body))])).digest('hex');
}
export function signHandoff(key: string, path: string, body: unknown, now=Date.now(), nonce=opaque()) {
  const timestamp=String(Math.floor(now/1000));
  return {'x-oauth-time':timestamp,'x-oauth-nonce':nonce,'x-oauth-signature':signature(key,path,timestamp,nonce,body)};
}
export function verifyHandoff(key: string, path: string, body: unknown, headers: {get(name: string): string | null}, now=Date.now()) {
  const timestamp=headers.get('x-oauth-time') || '',nonce=headers.get('x-oauth-nonce') || '',mac=headers.get('x-oauth-signature') || '';
  if(!/^\d{10}$/.test(timestamp)||!isOpaque(nonce)||Math.abs(now-Number(timestamp)*1000)>60000||canonicalBody(body).length>12000||!equalDigest(mac,signature(key,path,timestamp,nonce,body)))throw new Error('OAUTH_PRIVATE_HANDOFF_REJECTED');
  return {nonceHash:digest(nonce),expiresAt:new Date(now+120000)};
}
export function boundedCallback(url: URL) {
  if(url.href.length>8192||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||url.searchParams.has('error')||[...url.searchParams.keys()].some(k=>!['code','state'].includes(k)))throw new Error('OAUTH_CALLBACK_REJECTED');
  const state=url.searchParams.get('state'),code=url.searchParams.get('code');
  if(!isOpaque(state)||!code||code==='null'||code.length>4096||/[\x00-\x20\x7f]/.test(code))throw new Error('OAUTH_CALLBACK_REJECTED');
  return {state,code};
}
export type RouterRecord = {
  state_hash:string; flow_kind:'SAAS'|'NATIVE'; operation_id:string; created_at:Date; expires_at:Date; consumed_at:Date|null;
  workspace_id:string|null; channel_id:string|null; actor_id:string|null; session_id:string|null;
  native_issuer:string|null; native_browser_hash:string|null; completion_identity:string|null; ticket_hash:string|null;
  browser_hash:string|null; bound_at:Date|null; integrity_mac:string;
};
export function recordMac(record: Omit<RouterRecord,'integrity_mac'>, key: string) {
  return createHmac('sha256',privateKey(key)).update(canonicalBody(['OUTREACH_ROUTER_RECORD_V1',record.state_hash,record.flow_kind,record.operation_id,record.created_at.toISOString(),record.expires_at.toISOString(),record.consumed_at?.toISOString()||null,record.workspace_id,record.channel_id,record.actor_id,record.session_id,record.native_issuer,record.native_browser_hash,record.completion_identity,record.ticket_hash,record.browser_hash,record.bound_at?.toISOString()||null])).digest('hex');
}
export function validRecord(record: RouterRecord,key: string,now=Date.now()) {
  if(!equalDigest(record.integrity_mac,recordMac(record,key))||record.consumed_at||record.expires_at.getTime()<=now||record.created_at.getTime()>now+1000||record.expires_at.getTime()-record.created_at.getTime()>600000)throw new Error('OAUTH_STATE_REJECTED');
  return record;
}
