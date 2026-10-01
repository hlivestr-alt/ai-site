import {rateLimit} from './core';
import {query} from './db';
import {boundedSetting} from './operational-config';
export function sensitiveOperation(path:string,method:string){
  if(method==='POST'&&/\/invitations$/.test(path))return 'invite';
  if(/upload-intents$|\/sources(?:\/[^/]+\/(?:upload|parts))?$/.test(path)&&(method==='POST'||method==='GET'&&path.endsWith('/upload')))return 'upload';
  if(method==='POST'&&(/\/billing\/quotes$/.test(path)||path.endsWith('/workflows/estimate')))return 'quote';
  if(method==='POST'&&/\/(ai-videos|clipper)$/.test(path))return 'submission';
  if(method==='POST'&&/\/workflows\/[^/]+\/runs$/.test(path))return 'workflow_start';
  if(method==='POST'&&/\/billing\/payments$/.test(path))return 'payment_create';
  if(method==='GET'&&/\/billing\/payments(?:\/[^/]+)?$/.test(path))return 'payment_poll';
  if(method==='GET'&&/\/(media|download|preview)$/.test(path))return 'media_sign';
  return null;
}
const maxima:Record<string,number>={invite:30,upload:120,quote:120,submission:60,workflow_start:30,payment_create:20,payment_poll:300,media_sign:600};
export async function rateSensitiveRequest(request:Request,userId:string){const path=new URL(request.url).pathname,operation=sensitiveOperation(path,request.method);if(!operation)return;const workspace=/\/workspaces\/([a-f0-9-]{36})\//i.exec(path)?.[1]||'none';await rateLimit({query},`sensitive:${operation}`,`${userId}:${workspace}`,boundedSetting(`RATE_LIMIT_${operation.toUpperCase()}`,maxima[operation],1,100000),boundedSetting('RATE_LIMIT_WINDOW_SECONDS',900,1,86400));}
export async function rateAuthRequest(request:Request){const path=new URL(request.url).pathname;if(request.method!=='POST'||!/^\/api\/auth\/(login|register|forgot-password|resend-verification)$/.test(path))return;const ip=process.env.TRUST_PROXY_HEADERS==='1'?(request.headers.get('x-forwarded-for')||'unknown').split(',')[0].trim().slice(0,80):'unknown';await rateLimit({query},`auth-ip:${path}`,ip,boundedSetting('RATE_LIMIT_AUTH_IP',['local','test'].includes(process.env.APP_ENV||'')?5000:30,1,100000));}
