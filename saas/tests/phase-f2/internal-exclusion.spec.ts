import {test,expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {fixture,invoke,ownedReal,channel,stats,close,evidence} from '../phase-f1/support';

test('F2: private confirmed internal identity is excluded even with shared app configuration',async()=>{
  const identity=process.env.PHASE_F2_CONFIRMED_INTERNAL_ACCOUNT||'controlled_phase_f2_internal';
  const fingerprint=createHash('sha256').update(JSON.stringify({provider:'TIKTOK_SHOP',account:identity})).digest('hex');
  if(process.env.PHASE_F2_CONFIRMED_INTERNAL_ACCOUNT)expect((process.env.OUTREACH_INTERNAL_ACCOUNT_FINGERPRINTS||'').split(',').includes(fingerprint)).toBe(true);
  const f=await fixture();
  try{
    const response=await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/channels`,{data:{provider:'TIKTOK_SHOP',label:'Internal exclusion fixture'}});
    expect(response.status()).toBe(201);const c=(await response.json()).channel;
    await f.db.query('INSERT INTO outreach_provider_fixtures(workspace_id,channel_id,external_identity) VALUES($1,$2,$3)',[f.workspaceId,c.id,identity]);
    const sharedApp={OUTREACH_TIKTOK_APP_KEY:'same_controlled_developer_app',OUTREACH_TIKTOK_APP_SECRET:'same_controlled_signing_secret',OUTREACH_TIKTOK_SERVICE_ID:'same_controlled_service',OUTREACH_INTERNAL_ACCOUNT_FINGERPRINTS:fingerprint};
    expect(invoke('connect',f,c.id,'',sharedApp).status).toBe(409);
    expect((await channel(f,c.id)).status==='CONNECTED').toBe(false);
    expect((await f.db.query('SELECT count(*)::int n FROM outreach_channel_credentials WHERE channel_id=$1',[c.id])).rows[0].n).toBe(0);
    expect((await stats(f,c.id)).message_calls).toBe(0);
    const unrelated=await ownedReal(f,'VALID','controlled_phase_f2_unrelated');
    expect((await channel(f,unrelated.id)).status).toBe('CONNECTED');
    await evidence('internal-exclusion',{status:'PASS',confirmedPrivateIdentityTested:!!process.env.PHASE_F2_CONFIRMED_INTERNAL_ACCOUNT,internalRejected:true,unrelatedQaAllowed:true,sharedAppCannotBypass:true,nativeCredentialsImported:0,realProviderCalls:0});
  }finally{await close(f);}
});

test('F2: direct API fields cannot establish provider identity or override the exclusion',async()=>{
  const identity=process.env.PHASE_F2_CONFIRMED_INTERNAL_ACCOUNT||'controlled_phase_f2_internal',f=await fixture();
  try{
    const response=await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/channels`,{data:{provider:'TIKTOK_SHOP',label:'Manipulated connection fixture',providerIdentity:identity,provider_identity:identity,status:'CONNECTED',outboundCapable:true,authorizationRealm:'REAL',internalExclusion:false,allowInternal:true,credentialVersion:99}});
    if(response.status()===201){const c=(await response.json()).channel;
      const stored=(await f.db.query('SELECT status,provider_identity,credential_reference,credential_version FROM outreach_channels WHERE id=$1',[c.id])).rows[0];
      expect(stored.provider_identity===null&&stored.credential_reference===null&&stored.credential_version===0&&stored.status!=='CONNECTED').toBe(true);
      await f.db.query('INSERT INTO outreach_provider_fixtures(workspace_id,channel_id,external_identity) VALUES($1,$2,$3)',[f.workspaceId,c.id,identity]);
      const fingerprint=createHash('sha256').update(JSON.stringify({provider:'TIKTOK_SHOP',account:identity})).digest('hex');
      expect(invoke('connect',f,c.id,'',{OUTREACH_INTERNAL_ACCOUNT_FINGERPRINTS:fingerprint}).status).toBe(409);
      expect((await stats(f,c.id)).message_calls).toBe(0);
    }else expect([400,422].includes(response.status())).toBe(true);
    await evidence('direct-api-exclusion',{status:'PASS',browserIdsNotOwnershipProof:true,clientOverrideCannotBypass:true,realProviderCalls:0});
  }finally{await close(f);}
});
