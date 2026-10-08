import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {digest,opaque,boundedCallback,recordMac,validRecord,signHandoff,verifyHandoff,REGISTER_PATH,COMPLETE_PATH,type RouterRecord} from '../../src/lib/outreach-oauth-core';
const key=()=>randomBytes(32).toString('hex');
function record():RouterRecord{return {state_hash:digest(opaque()),flow_kind:'SAAS',operation_id:randomUUID(),created_at:new Date(),expires_at:new Date(Date.now()+60000),consumed_at:null,workspace_id:randomUUID(),channel_id:randomUUID(),actor_id:randomUUID(),session_id:randomUUID(),native_issuer:null,native_browser_hash:null,completion_identity:null,ticket_hash:null,browser_hash:null,bound_at:null,integrity_mac:''};}
test('F1 router MAC binds every routing, identity, browser and operation field',()=>{
  const k=key(),r=record();r.integrity_mac=recordMac(r,k);assert.equal(validRecord(r,k),r);
  for(const [field,value] of Object.entries({flow_kind:'NATIVE',state_hash:digest(opaque()),operation_id:randomUUID(),workspace_id:randomUUID(),channel_id:randomUUID(),actor_id:randomUUID(),session_id:randomUUID(),native_issuer:'NATIVE_OPERATOR_V1',native_browser_hash:digest(opaque()),completion_identity:'NATIVE_PRIVATE_V1',ticket_hash:digest(opaque()),browser_hash:digest(opaque()),bound_at:new Date(),created_at:new Date(Date.now()-10),expires_at:new Date(Date.now()+10000)}))assert.throws(()=>validRecord({...r,[field]:value},k));
  assert.throws(()=>validRecord(r,key()));assert.throws(()=>validRecord({...r,consumed_at:new Date()},k));assert.throws(()=>validRecord(r,k,Date.now()+120000));
});
test('F1 callback accepts only bounded opaque state and a single provider code',()=>{
  const state=opaque(),code=opaque(),url=new URL('https://fixture.example/callback');url.searchParams.set('state',state);url.searchParams.set('code',code);
  assert.equal(boundedCallback(url).state===state,true);
  for(const suffix of ['&state='+opaque(),'&code='+opaque(),'&target=native','&workspace='+randomUUID(),'&shop=untrusted','&next=https://attacker.example','&returnUrl=https://attacker.example','&error=denied'])assert.throws(()=>boundedCallback(new URL(url.href+suffix)));
  assert.throws(()=>boundedCallback(new URL('https://fixture.example/callback?state='+opaque()+'&code='+'x'.repeat(4097))));
});
test('F1 private handoff authenticates direction, exact body, timestamp and nonce',()=>{
  const k=key(),body={state:opaque(),code:opaque(),operationId:randomUUID(),browserHash:digest(opaque())},headers=new Headers(signHandoff(k,COMPLETE_PATH,body));
  assert.ok(verifyHandoff(k,COMPLETE_PATH,body,headers).nonceHash);
  assert.throws(()=>verifyHandoff(k,REGISTER_PATH,body,headers));assert.throws(()=>verifyHandoff(key(),COMPLETE_PATH,body,headers));assert.throws(()=>verifyHandoff(k,COMPLETE_PATH,{...body,code:opaque()},headers));assert.throws(()=>verifyHandoff(k,COMPLETE_PATH,body,headers,Date.now()+61000));assert.throws(()=>verifyHandoff(k,COMPLETE_PATH,body,new Headers()));
  assert.equal(JSON.stringify(verifyHandoff(k,COMPLETE_PATH,body,headers)).includes(body.code),false);
});
