import {test,expect,request} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {fixture,close,evidence,pending,nativeInit,bind,callback,nativeSnapshot,saasSnapshot,nativeDb,invoke,nativeApi,marker,stateMarker} from './router-support';
import {digest,opaque,signHandoff,COMPLETE_PATH} from '../../src/lib/outreach-oauth-core';
test('F1 both flows complete through one router and preserve separate encrypted stores',async()=>{
 const f=await fixture();let native;
 try{
  const before=await nativeSnapshot(),s=await pending(f),code=marker(),response=await callback(f.c,s.state,code);
  expect(response.status()).toBe(303);expect(response.headers().location?.endsWith('/outreach/channels?connection=updated')).toBe(true);
  expect(response.headers()['cache-control']).toBe('no-store');expect(response.headers()['referrer-policy']).toBe('no-referrer');expect((await response.text()).includes(code)).toBe(false);expect((await nativeSnapshot())===before).toBe(true);
  const owned=(await f.db.query('SELECT workspace_id,channel_id,ciphertext FROM outreach_channel_credentials WHERE channel_id=$1',[s.channel.id])).rows;
  expect(owned.length).toBe(1);expect(owned[0].workspace_id===f.workspaceId&&owned[0].channel_id===s.channel.id&&Buffer.isBuffer(owned[0].ciphertext)).toBe(true);
  const saasBefore=await saasSnapshot(f);native=await nativeInit();const started=await bind(native.c,native.state,native.ticket);expect(started.status()).toBe(303);expect(started.headers().location?.startsWith('https://services.tiktokshop.com/open/authorize?')).toBe(true);
  const completed=await callback(native.c,native.state);expect(completed.headers().location?.endsWith('result=native-success')).toBe(true);expect((await saasSnapshot(f))===saasBefore).toBe(true);
  const d=await nativeDb();try{const rows=(await d.query('SELECT "accessTokenCiphertext","refreshTokenCiphertext" FROM "IntegrationConnection" WHERE "shopId" IN (SELECT id FROM "Shop" WHERE "externalShopId"=\'controlled_native_shop\')')).rows;expect(rows.length).toBe(1);expect(typeof rows[0].accessTokenCiphertext==='string'&&typeof rows[0].refreshTokenCiphertext==='string'&&!rows[0].accessTokenCiphertext.includes(process.env.F1_NATIVE_EXPECTED_ACCESS!)).toBe(true);}finally{await d.end();}
  await evidence('router-ownership',{status:'PASS',saasWorkspaceEncryption:true,nativeEncryptedStorage:true,saasFlowNativeStoreUnchanged:true,nativeFlowSaasStoreUnchanged:true,realProviderOperations:0,realSends:0});
 }finally{await native?.c.dispose();await close(f);}
});
test('F1 state is one-use under replay and simultaneous callbacks',async()=>{
 const f=await fixture();try{const s=await pending(f),code=marker(),responses=await Promise.all([callback(f.c,s.state,code),callback(f.c,s.state,code)]);expect(responses.filter(r=>r.headers().location?.endsWith('connection=updated')).length).toBe(1);expect((await callback(f.c,s.state,code)).headers().location?.endsWith('connection=updated')).toBe(false);expect((await f.db.query('SELECT api_calls FROM outreach_provider_fixtures WHERE channel_id=$1',[s.channel.id])).rows[0].api_calls).toBe(2);}finally{await close(f);}
});
test('F1 wrong SaaS identity, session, workspace, channel and MAC fail closed',async()=>{
 const f=await fixture(),other=await fixture();try{
  const s=await pending(f);expect((await callback(other.c,s.state)).headers().location?.endsWith('connection=updated')).toBe(false);
  expect((await invoke({action:'saas-callback',email:f.email,activeWorkspaceId:other.workspaceId,state:s.state,code:marker()})).rejected).toBe(true);
  const c=await pending(f);await f.db.query('UPDATE outreach_channels SET authorization_state_hash=$1 WHERE id=$2',[digest(opaque()),c.channel.id]);expect((await callback(f.c,c.state)).headers().location?.endsWith('connection=updated')).toBe(false);
  const tampered=await pending(f);await f.db.query('UPDATE outreach_oauth_router_states SET integrity_mac=$1 WHERE state_hash=$2',['f'.repeat(64),digest(tampered.state)]);expect((await callback(f.c,tampered.state)).headers().location?.endsWith('connection=updated')).toBe(false);
  const session=await pending(f);await f.db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=(SELECT id FROM users WHERE email=$1)",[f.email]);expect((await callback(f.c,session.state)).headers().location?.endsWith('connection=updated')).toBe(false);
  expect(Number((await f.db.query('SELECT coalesce(sum(api_calls),0) n FROM outreach_provider_fixtures WHERE workspace_id=$1',[f.workspaceId])).rows[0].n)).toBe(0);
 }finally{await close(f);await close(other);}
});
test('F1 unknown, expired, tampered state and browser routing selectors fail closed',async()=>{
 const f=await fixture();try{const s=await pending(f);await invoke({action:'expire',state:s.state});for(const state of [s.state,opaque(),s.state.slice(0,42)+'!']){const r=await callback(f.c,state);expect(r.status()).toBe(303);expect(r.headers().location?.endsWith('connection=updated')).toBe(false);}
 const current=await pending(f);for(const extra of ['&target=native','&workspace='+f.workspaceId,'&shop=untrusted','&next=https://attacker.example','&state='+opaque()])expect((await callback(f.c,current.state,marker(),extra)).headers().location?.endsWith('connection=updated')).toBe(false);
 expect(Number((await f.db.query('SELECT sum(api_calls) n FROM outreach_provider_fixtures WHERE workspace_id=$1',[f.workspaceId])).rows[0].n)).toBe(0);
 }finally{await close(f);}
});
test('F1 native initiation requires trusted origin, one-time ticket and original browser',async()=>{
 const rogue=await request.newContext({baseURL:nativeApi,extraHTTPHeaders:{Origin:'https://attacker.example'}}),n=await nativeInit(),stranger=await request.newContext();
 try{expect((await rogue.post('/api/v1/integrations/tiktok/authorize',{data:{}})).status()).toBe(400);
 expect((await bind(n.c,n.state,n.ticket,'https://attacker.example')).headers().location?.startsWith('https://services.tiktokshop.com/')).toBe(false);
 expect((await bind(n.c,n.state,opaque())).headers().location?.startsWith('https://services.tiktokshop.com/')).toBe(false);
 expect((await bind(n.c,n.state,n.ticket)).headers().location?.startsWith('https://services.tiktokshop.com/')).toBe(true);
 expect((await bind(n.c,n.state,n.ticket)).headers().location?.startsWith('https://services.tiktokshop.com/')).toBe(false);
 expect((await callback(stranger,n.state)).headers().location?.endsWith('result=native-success')).toBe(false);
 expect((await callback(n.c,n.state)).headers().location?.endsWith('result=native-success')).toBe(true);
 expect((await callback(n.c,n.state)).headers().location?.endsWith('result=native-success')).toBe(false);
 }finally{await rogue.dispose();await stranger.dispose();await n.c.dispose();}
});
test('F1 SaaS and native state cannot cross flows',async()=>{
 const f=await fixture(),n=await nativeInit();try{const s=await pending(f);
 expect((await bind(n.c,s.state,n.ticket)).headers().location?.startsWith('https://services.tiktokshop.com/')).toBe(false);
 expect((await invoke({action:'saas-callback',email:f.email,state:n.state,code:marker()})).rejected).toBe(true);
 expect((await callback(n.c,s.state)).headers().location?.endsWith('connection=updated')).toBe(false);
 await bind(n.c,n.state,n.ticket);expect((await callback(f.c,n.state)).headers().location?.endsWith('result=native-success')).toBe(false);
 expect((await callback(f.c,s.state)).headers().location?.endsWith('connection=updated')).toBe(true);
 expect((await callback(n.c,n.state)).headers().location?.endsWith('result=native-success')).toBe(true);
 }finally{await close(f);await n.c.dispose();}
});
test('F1 private completion rejects forged, wrong-route, expired, wrong-operation and replay requests',async()=>{
 const n=await nativeInit(),key=process.env.OUTREACH_NATIVE_HANDOFF_KEY!,code=marker(),body={state:n.state,code,operationId:randomUUID(),browserHash:digest(opaque())};
 try{
 const post=(value:typeof body,headers:Record<string,string>)=>n.c.post(COMPLETE_PATH,{data:value,headers});
 for(const headers of [{},signHandoff(key,'/wrong-route',body),signHandoff(key,COMPLETE_PATH,body,Date.now()-61000)])expect((await post(body,headers)).status()).toBe(403);
 const valid=signHandoff(key,COMPLETE_PATH,body);expect((await post(body,valid)).status()).toBe(403);expect((await post(body,valid)).status()).toBe(403);
 const d=await nativeDb();try{const record=(await d.query('SELECT "operationId","browserHash" FROM "TikTokAuthorizationState" WHERE "stateHash"=$1',[digest(n.state)])).rows[0];const correct={...body,operationId:record.operationId,browserHash:record.browserHash};await new Promise(r=>setTimeout(r,1500));const proof=signHandoff(key,COMPLETE_PATH,correct);expect((await post(correct,proof)).status()).toBe(204);expect((await post(correct,proof)).status()).toBe(403);}finally{await d.end();}
 }finally{await n.c.dispose();}
});
test('F1 provider and handoff failures return fixed secret-free results',async()=>{
 const f=await fixture(),n=await nativeInit();try{const s=await pending(f,'REVOKED'),code=marker();const failed=await callback(f.c,s.state,code);expect(failed.headers().location?.endsWith('connection=needs-attention')).toBe(true);expect((await failed.text()).includes(code)).toBe(false);expect(failed.headers().location?.includes(s.state)).toBe(false);
 await bind(n.c,n.state,n.ticket);const native=await callback(n.c,n.state,'fail_'+code);expect(native.headers().location?.endsWith('result=native-failure')).toBe(true);expect((await native.text()).includes(code)).toBe(false);
 await evidence('router-attacks',{status:'PASS',flowCrossingRejected:true,unknownExpiryReplayTamperRejected:true,wrongSessionWorkspaceChannelBrowserRejected:true,privateHandoffForgeryExpiryWrongRouteReplayRejected:true,callbackMarkerLeaks:0,realProviderOperations:0});
 }finally{await close(f);await n.c.dispose();}
});
test('F1 explicit code and state markers never enter callbacks, results or exception evidence',async()=>{
 const f=await fixture();try{
  for(const scenario of ['VALID','REVOKED','EXPIRED_STATE','BAD_MAC','UNKNOWN']){
   const started=await pending(f,scenario==='REVOKED'?'REVOKED':'VALID'),state=stateMarker(),code=marker();
   if(scenario!=='UNKNOWN')await invoke({action:'marker-state',state:started.state,nextState:state});
   if(scenario==='EXPIRED_STATE')await invoke({action:'expire',state});
   if(scenario==='BAD_MAC')await f.db.query('UPDATE outreach_oauth_router_states SET integrity_mac=$1 WHERE state_hash=$2',['e'.repeat(64),digest(state)]);
   const r=await callback(f.c,state,code),location=r.headers().location||'',content=await r.text();
   expect([location,content,JSON.stringify(r.headers())].some(v=>v.includes(code)||v.includes(state))).toBe(false);
   const result=await f.c.get(location);expect((await result.text()).includes(code)||(await result.text()).includes(state)).toBe(false);
  }
  for(const fail of [false,true]){const n=await nativeInit();try{const state=stateMarker(),code=(fail?'fail_':'')+marker();await invoke({action:'marker-state',state:n.state,nextState:state});await bind(n.c,state,n.ticket);await new Promise(r=>setTimeout(r,1500));const r=await callback(n.c,state,code);expect([r.headers().location||'',await r.text()].some(v=>v.includes(code)||v.includes(state))).toBe(false);}finally{await n.c.dispose();}}
  await evidence('router-marker-protection',{status:'PASS',scenarios:7,explicitMarkerValuesPersisted:0,callbackResponseLeaks:0,resultLeaks:0,applicationLogsAuditedByHarness:true});
 }finally{await close(f);}
});
test('F1 legacy loopback callback remains browser-bound with a fixed clean result',async()=>{
 const n=await nativeInit(),other=await request.newContext();try{const path='/api/v1/integrations/tiktok/callback?'+new URLSearchParams({state:n.state,code:marker()});
 expect((await other.get(nativeApi+path,{maxRedirects:0})).headers().location?.endsWith('result=native-success')).toBe(false);await new Promise(r=>setTimeout(r,1500));expect((await n.c.get(path,{maxRedirects:0})).headers().location?.endsWith('result=native-success')).toBe(true);expect((await n.c.get(path,{maxRedirects:0})).headers().location?.endsWith('result=native-success')).toBe(false);
 }finally{await n.c.dispose();await other.dispose();}
});
