import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fixture, ownedReal, ready, admitReal, invoke, stats, channel, drain, ledger, close, evidence, type Fixture } from './support';
import { login } from '../stabilization/support';
test('A/B: owned fake-real connection, authenticated encryption and secret-free browser metadata', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f), dto = await channel(f, c.id);
        expect(dto).toMatchObject({ status: 'CONNECTED', simulation: true, certification: 'NOT_TESTED', bulkSendingEnabled: false });
        expect(invoke('audit-storage', f, c.id)).toEqual({ envelopeOnly: true, safeColumns: true, keyVersion: 1, serverDecryption: true });
        const serialized = JSON.stringify(dto);
        expect(/credential_reference|provider_identity|access_token|refresh_token|ciphertext|fixture_access_|fixture_refresh_|fixture_cipher_/.test(serialized)).toBe(false);
        await evidence('provider-a-b', { status: 'PASS', ownership: true, encryptedEnvelopeOnly: true, serverOnlyDecryption: true, publicSecretFields: 0, externalMessages: 0 });
    }
    finally {
        await close(f);
    }
});
for (const scenario of ['EXPIRED', 'REVOKED', 'UNAUTHORIZED'] as const) {
    test(`C: ${scenario} stops dispatch and requires reauthorization without another account`, async () => {
        const f = await fixture();
        try {
            const c = await ownedReal(f);
            await f.db.query('UPDATE outreach_provider_fixtures SET scenario=$1 WHERE channel_id=$2', [scenario, c.id]);
            expect(invoke('verify', f, c.id).status).toBe(409);
            expect((await channel(f, c.id)).status).toBe('NEEDS_REAUTH');
            const before = await stats(f, c.id);
            invoke('tick');
            expect(await stats(f, c.id)).toEqual(before);
            expect(before.message_calls).toBe(0);
            expect((await f.db.query('SELECT count(*)::int n FROM outreach_credential_versions WHERE channel_id=$1', [c.id])).rows[0].n).toBe(1);
            await evidence(`provider-c-${scenario.toLowerCase()}`, { status: 'PASS', needsReauthorization: true, noAlternateSender: true, externalMessages: 0 });
        }
        finally {
            await close(f);
        }
    });
}
test('C: expired local metadata and missing scope never authorize new work', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f);
        await f.db.query("UPDATE outreach_channels SET access_expires_at=now()-interval '1 second' WHERE id=$1", [c.id]);
        invoke('recover');
        expect((await channel(f, c.id)).status).toBe('NEEDS_REAUTH');
        const bad = await ownedReal(f, 'BAD_SCOPE');
        expect(await channel(f, bad.id)).toMatchObject({ status: 'NEEDS_REAUTH', outboundCapable: false });
        expect(invoke('recipient', f, bad.id).status).toBe(409);
        expect((await stats(f, c.id)).message_calls).toBe(0);
        await evidence('provider-c-expiry-scope', { status: 'PASS', expiredMetadata: true, missingSendScope: true, messageCalls: 0 });
    }
    finally {
        await close(f);
    }
});
test('D: verified credential replacement retires metadata atomically; uncertain refresh requires reconnect', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f);
        expect(invoke('refresh', f, c.id)).toEqual({ refreshed: true });
        const versions = (await f.db.query('SELECT version,status FROM outreach_credential_versions WHERE channel_id=$1 ORDER BY version', [c.id])).rows;
        expect(versions).toEqual([{ version: 1, status: 'RETIRED' }, { version: 2, status: 'ACTIVE' }]);
        expect((await stats(f, c.id)).refresh_calls).toBe(1);
        await expect(f.db.query("UPDATE outreach_channel_credentials SET ciphertext='corrupted'::bytea WHERE channel_id=$1", [c.id])).rejects.toHaveProperty('code');
        await f.db.query("UPDATE outreach_provider_fixtures SET scenario='REFRESH_UNKNOWN' WHERE channel_id=$1", [c.id]);
        expect(invoke('refresh', f, c.id).status).toBe(409);
        expect((await channel(f, c.id)).status).toBe('NEEDS_REAUTH');
        const before = await stats(f, c.id);
        expect(invoke('refresh', f, c.id).status).toBe(409);
        expect(await stats(f, c.id)).toEqual(before);
        expect(before.refresh_calls).toBe(2);
        await evidence('provider-d', { status: 'PASS', versions: 2, activeVersions: 1, immutableEnvelopes: true, uncertainRefreshNotRetried: true, messageCalls: 0 });
    }
    finally {
        await close(f);
    }
});
test('E: external identity is unique across Workspaces; internal-account exclusion fails closed', async () => {
    const f = await fixture(), other = await fixture();
    try {
        const shared = 'controlled_duplicate_shop', c = await ownedReal(f, 'VALID', shared);
        const r = await other.c.post(`/api/workspaces/${other.workspaceId}/outreach/channels`, { data: { provider: 'TIKTOK_SHOP', label: 'Foreign identity attempt' } }), duplicate = (await r.json()).channel;
        await other.db.query('INSERT INTO outreach_provider_fixtures(workspace_id,channel_id,external_identity) VALUES($1,$2,$3)', [other.workspaceId, duplicate.id, shared]);
        expect(invoke('connect', other, duplicate.id).status).toBe(409);
        await expect(f.db.query('UPDATE outreach_channels SET provider_identity=$1 WHERE id=$2', ['reassigned_shop', c.id])).rejects.toHaveProperty('code');
        const pending = await other.c.post(`/api/workspaces/${other.workspaceId}/outreach/channels`, { data: { provider: 'TIKTOK_SHOP', label: 'Excluded fixture' } }), internal = (await pending.json()).channel;
        await other.db.query('INSERT INTO outreach_provider_fixtures(workspace_id,channel_id,external_identity) VALUES($1,$2,$3)', [other.workspaceId, internal.id, 'controlled_internal_exclusion']);
        expect(invoke('deny-internal', other, internal.id).status).toBe(409);
        expect((await stats(other, internal.id)).message_calls).toBe(0);
        await evidence('provider-e', { status: 'PASS', uniqueProviderIdentity: true, reassignmentDenied: true, internalExclusionDenied: true, nativeCredentialsImported: 0 });
    }
    finally {
        await close(f);
        await close(other);
    }
});
test('F: callback ownership, state freshness, supersession and replay are enforced', async () => {
    const f = await fixture(), other = await fixture();
    try {
        const c = await ownedReal(f), checks = invoke('callbacks', f, c.id, other.email);
        expect(checks).toEqual({ badState: 400, wrongSession: 400, superseded: 400, current: 200, replay: 400, expired: 400 });
        expect((await channel(f, c.id)).status).toBe('CONNECTED');
        const response = await f.c.get('/api/outreach/tiktok/callback?state=invalid&code=invalid', { maxRedirects: 0 });
        expect(response.status()).toBe(303);
        expect(response.headers()['referrer-policy']).toBe('no-referrer');
        expect(response.headers().location.includes('state=')).toBe(false);
        expect(response.headers().location.includes('code=')).toBe(false);
        await evidence('provider-f', { status: 'PASS', checks, callbackQueryNotReflected: true, webhooks: 'Not provided by inspected contract; no speculative endpoint' });
    }
    finally {
        await close(f);
        await close(other);
    }
});
test('G: full Retry-After stops claims and does not clip a one-hour provider limit', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f), ticket = await ready(f, c), campaign = await admitReal(f, ticket);
        await f.db.query("UPDATE outreach_provider_fixtures SET scenario='RATE_LIMIT_LONG',api_calls=0 WHERE channel_id=$1", [c.id]);
        invoke('tick');
        const d = (await f.db.query('SELECT state,available_at FROM outreach_deliveries WHERE campaign_id=$1', [campaign.id])).rows[0];
        expect(d.state).toBe('RETRYABLE');
        expect(d.available_at.getTime() - Date.now()).toBeGreaterThan(3500000);
        const before = await stats(f, c.id);
        for (let n = 0; n < 3; n++)
            invoke('tick');
        expect(await stats(f, c.id)).toEqual(before);
        expect(before.message_calls).toBe(0);
        await evidence('provider-g', { status: 'PASS', retryAfterMs: 3600000, immediateAdditionalProviderCalls: 0, messageCalls: 0 });
    }
    finally {
        await close(f);
    }
});
test('G: temporary pre-send rate failure resumes through the same bounded attempt/outbox path', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f), ticket = await ready(f, c), campaign = await admitReal(f, ticket);
        await f.db.query("UPDATE outreach_provider_fixtures SET scenario='RATE_LIMIT',api_calls=0 WHERE channel_id=$1", [c.id]);
        expect(await drain(f, campaign.id)).toBe('COMPLETED');
        expect((await stats(f, c.id)).message_calls).toBe(1);
        expect((await f.db.query('SELECT send_attempts,status FROM outreach_canary_approvals WHERE id=$1', [ticket.id])).rows[0]).toEqual({ send_attempts: 1, status: 'SENT' });
        expect((await ledger(f, campaign.id)).map(r => r.entry_type)).toEqual(['CAPTURE', 'RESERVE']);
        await evidence('provider-g-resume', { status: 'PASS', sameOutbox: true, simulatedMessageCalls: 1, capturedTokens: 10, externalMessages: 0 });
    }
    finally {
        await close(f);
    }
});
test('H/J: ambiguous dispatch holds reservation and exclusion across disconnect; reconciliation cannot guess', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f), ticket = await ready(f, c), campaign = await admitReal(f, ticket);
        await f.db.query("UPDATE outreach_provider_fixtures SET scenario='UNKNOWN' WHERE channel_id=$1", [c.id]);
        expect(await drain(f, campaign.id)).toBe('DELIVERY_UNKNOWN');
        expect((await stats(f, c.id)).message_calls).toBe(1);
        const prefix = `/api/workspaces/${f.workspaceId}/outreach/campaigns/${campaign.id}`;
        expect((await (await f.c.post(`${prefix}/reconcile`, { data: {} })).json()).resolved).toBe(0);
        expect((await ledger(f, campaign.id)).map(r => r.entry_type)).toEqual(['RESERVE']);
        expect(invoke('disconnect', f, c.id)).toMatchObject({ disconnected: true });
        const before = await stats(f, c.id);
        for (let n = 0; n < 3; n++)
            invoke('tick');
        expect(await stats(f, c.id)).toEqual(before);
        expect(invoke('connect', f, c.id).status).toBe(409);
        const state = (await f.db.query('SELECT unknown_delivery_id FROM outreach_contact_state WHERE channel_id=$1', [c.id])).rows[0];
        expect(!!state.unknown_delivery_id).toBe(true);
        const wallet = (await f.db.query('SELECT available_tokens,reserved_tokens FROM billing_account_wallets WHERE billing_account_id=(SELECT billing_account_id FROM workspaces WHERE id=$1)', [f.workspaceId])).rows[0];
        expect(wallet).toEqual({ available_tokens: '990', reserved_tokens: '10' });
        expect(invoke('audit', f)).toMatchObject({ consistent: true, unresolvedUnknown: 1 });
        await expect(f.db.query("UPDATE outreach_deliveries SET state='RETRYABLE' WHERE campaign_id=$1", [campaign.id])).rejects.toHaveProperty('code');
        await evidence('provider-h-j', { status: 'PASS', simulatedMessageCalls: 1, automaticRetries: 0, heldTokens: 10, retainedContactExclusion: true, disconnectPreservedHistory: true, unprovenReconciliationResolved: 0 });
    }
    finally {
        await close(f);
    }
});
test('H/proof: accepted proof survives lost completion and resolves once without another send', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f), ticket = await ready(f, c), campaign = await admitReal(f, ticket), accepted = invoke('provider-before-completion');
        expect(accepted).toMatchObject({ state: 'SENT', proofStored: true });
        await new Promise(resolve => setTimeout(resolve, 5500));
        invoke('recover');
        const url = `/api/workspaces/${f.workspaceId}/outreach/campaigns/${campaign.id}/reconcile`;
        expect((await (await f.c.post(url, { data: {} })).json()).resolved).toBe(1);
        expect((await (await f.c.post(url, { data: {} })).json()).resolved).toBe(0);
        expect((await stats(f, c.id)).message_calls).toBe(1);
        expect((await ledger(f, campaign.id)).map(r => r.entry_type)).toEqual(['CAPTURE', 'RESERVE']);
        expect((await channel(f, c.id)).certification).toBe('CANARY_READY');
        expect(invoke('audit', f)).toMatchObject({ consistent: true, unresolvedUnknown: 0 });
        await evidence('provider-proof-recovery', { status: 'PASS', durableAcceptedMessageEvidence: true, reconciliations: [1, 0], simulatedMessageCalls: 1, capturedTokens: 10, automaticCertification: false });
    }
    finally {
        await close(f);
    }
});
test('I/J: disconnect preserves completed history and stops queued or already claimed unsent work', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f), ticket = await ready(f, c), campaign = await admitReal(f, ticket);
        expect(invoke('disconnect', f, c.id)).toMatchObject({ disconnected: true });
        invoke('tick');
        expect((await stats(f, c.id)).message_calls).toBe(0);
        expect((await f.c.get(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${campaign.id}`)).status()).toBe(200);
        expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${campaign.id}/control`, { data: { action: 'cancel' } })).status()).toBe(200);
        expect((await ledger(f, campaign.id)).map(r => r.entry_type)).toEqual(['RELEASE', 'RESERVE']);
        await evidence('provider-i', { status: 'PASS', queuedDispatchStopped: true, historyPreserved: true, releasedTokens: 10, messageCalls: 0 });
    }
    finally {
        await close(f);
    }
});
test('K: controlled exact provider recipient is scoped and native/synthetic records cannot enter real targeting', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f);
        expect(invoke('prepare', f, '', JSON.stringify({ ...f.config, channelId: c.id })).status).toBe(409);
        await f.db.query("INSERT INTO outreach_creators(workspace_id,channel_id,creator_key,display_name,username,category_ids,followers,ordinal) VALUES($1,$2,'unauthorized_row','Unauthorized','unauthorized','[]',999999,10)", [f.workspaceId, c.id]);
        const ticket = await ready(f, c), q = (await (await f.c.post(`/api/workspaces/${f.workspaceId}/billing/quotes`, { data: { operation: 'OUTREACH', ...ticket.config } })).json()).quote;
        expect(q.selectedCount).toBe(1);
        expect(q.recipients[0].displayName).toBe('Controlled QA recipient');
        expect(invoke('recipient', f, c.id)).toMatchObject({ registered: true, existing: true });
        const r = await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/channels`, { data: { provider: 'TIKTOK_SHOP', label: 'No native import', nativeConnectionId: randomUUID() } });
        expect(r.status()).toBe(400);
        await evidence('provider-k', { status: 'PASS', source: 'CONTROLLED_PROVIDER_RECIPIENT', exactProviderIdentityRequired: true, unauthorizedRowExcluded: true, nativeDirectory: 'NOT CERTIFIED', nativeRecordsImported: 0 });
    }
    finally {
        await close(f);
    }
});
async function foreignChecks(f: Fixture, foreign: Fixture, c: {
    id: string;
}, campaignId: string) {
    const prefix = `/api/workspaces/${foreign.workspaceId}/outreach`, recipient = (await f.db.query('SELECT id FROM outreach_recipients WHERE campaign_id=$1', [campaignId])).rows[0].id, delivery = (await f.db.query('SELECT id FROM outreach_deliveries WHERE campaign_id=$1', [campaignId])).rows[0].id;
    for (const path of [`channels/${c.id}`, `channels/${c.id}/authorization`, `campaigns/${campaignId}`, `campaigns/${campaignId}/recipients/${recipient}/message`, `campaigns/${campaignId}/deliveries/${delivery}`])
        expect((await foreign.c.get(`${prefix}/${path}`)).status()).toBe(404);
    for (const action of ['authorize', 'verify', 'refresh', 'disconnect', 'select'])
        expect((await foreign.c.post(`${prefix}/channels/${c.id}/authorization`, { data: { action, ...(action === 'select' ? { choice: 'f'.repeat(64) } : {}) } })).status()).toBe(404);
    expect((await foreign.c.post(`/api/workspaces/${foreign.workspaceId}/billing/quotes`, { data: { operation: 'OUTREACH', ...f.config, channelId: c.id } })).status()).toBe(404);
}
test('L/N: foreign connection/campaign/recipient/delivery/control IDs remain private across billing accounts', async () => {
    const f = await fixture(), other = await fixture();
    try {
        const c = await ownedReal(f), ticket = await ready(f, c), campaign = await admitReal(f, ticket);
        await foreignChecks(f, other, c, campaign.id);
        const user = (await f.db.query('SELECT user_id FROM workspace_members WHERE workspace_id=$1', [f.workspaceId])).rows[0].user_id;
        await f.db.query("INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,'ADMIN','ACTIVE')", [other.workspaceId, user]);
        const switched = await login(f.email);
        try {
            expect((await switched.post(`/api/workspaces/${other.workspaceId}/select`)).status()).toBe(200);
            expect((await switched.get(`/api/workspaces/${other.workspaceId}/outreach/channels/${c.id}`)).status()).toBe(404);
        }
        finally {
            await switched.dispose();
        }
        await evidence('provider-l-n', { status: 'PASS', foreignReadsDenied: 5, foreignAuthorizationActionsDenied: 5, foreignQuoteDenied: true, crossAccountMemberCannotUseForeignChannel: true });
    }
    finally {
        await close(f);
        await close(other);
    }
});
test('M: confirmed fake-real send uses shared account wallet without sharing owned sender', async () => {
    const f = await fixture(), other = await fixture();
    try {
        const r = await f.c.post('/api/workspaces', { data: { name: 'Shared canary Brand B' } }), w = (await r.json()).workspace.id;
        const c = await ownedReal(f), ticket = await ready(f, c), campaign = await admitReal(f, ticket);
        expect(await drain(f, campaign.id)).toBe('COMPLETED');
        const sibling = await login(f.email);
        try {
            expect((await sibling.post(`/api/workspaces/${w}/select`)).status()).toBe(200);
            const a = (await (await f.c.get(`/api/workspaces/${f.workspaceId}/billing`)).json()).wallet, b = (await (await sibling.get(`/api/workspaces/${w}/billing`)).json()).wallet, y = (await (await other.c.get(`/api/workspaces/${other.workspaceId}/billing`)).json()).wallet;
            expect(a.availableTokens).toBe('990');
            expect(b.availableTokens).toBe('990');
            expect(b.billingAccountId).toBe(a.billingAccountId);
            expect(y.availableTokens).toBe('1000');
            expect(y.billingAccountId).not.toBe(a.billingAccountId);
            expect((await sibling.get(`/api/workspaces/${w}/outreach/channels/${c.id}`)).status()).toBe(404);
            expect((await ledger(f, campaign.id)).map(x => [x.entry_type, x.count])).toEqual([['CAPTURE', 1], ['RESERVE', 1]]);
        }
        finally {
            await sibling.dispose();
        }
        await evidence('provider-m', { status: 'PASS', sharedAvailableTokens: 990, separateAvailableTokens: 1000, capturedTokens: 10, singleReservation: true, senderShared: false, externalMessages: 0 });
    }
    finally {
        await close(f);
        await close(other);
    }
});
test('O: default gate, operator approval, exact config and one-message allowance all fail closed', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f), ticket = await ready(f, c, false), prefix = `/api/workspaces/${f.workspaceId}`;
        for (const patch of [{}, { targetCount: 2 }, { messageTemplate: 'Different message' }])
            expect((await f.c.post(`${prefix}/billing/quotes`, { data: { operation: 'OUTREACH', ...ticket.config, ...patch } })).status()).toBe(409);
        expect(invoke('approve', f, ticket.id, '', { PLATFORM_OPERATOR_EMAILS: '' }).status).toBe(403);
        expect(invoke('approve', f, ticket.id)).toMatchObject({ approved: true });
        expect((await f.c.post(`${prefix}/billing/quotes`, { data: { operation: 'OUTREACH', ...ticket.config, targetCount: 2 } })).status()).toBe(409);
        const campaign = await admitReal(f, ticket), before = await stats(f, c.id);
        expect(invoke('tick', undefined, '', '', { OUTREACH_REAL_SEND_ENABLED: '0' })).toEqual({ processed: false });
        expect(await stats(f, c.id)).toEqual(before);
        expect(await drain(f, campaign.id)).toBe('COMPLETED');
        expect((await stats(f, c.id)).message_calls).toBe(1);
        invoke('tick');
        invoke('tick');
        expect((await stats(f, c.id)).message_calls).toBe(1);
        expect((await f.c.post(`${prefix}/billing/quotes`, { data: { operation: 'OUTREACH', ...ticket.config } })).status()).toBe(409);
        await expect(f.db.query("UPDATE outreach_canary_approvals SET send_attempts=0,send_claimed_at=NULL,status='QUEUED' WHERE id=$1", [ticket.id])).rejects.toHaveProperty('code');
        expect((await f.db.query('SELECT count(*)::int n FROM outreach_campaigns WHERE workspace_id=$1', [f.workspaceId])).rows[0].n).toBe(1);
        await evidence('provider-o', { status: 'PASS', globalGateEnforced: true, approvalRequired: true, maxRecipients: 1, maxMessageAttempts: 1, changedMessageDenied: true, allowanceReplayDenied: true, bulkSending: false, externalMessages: 0 });
    }
    finally {
        await close(f);
    }
});
test('proof/accounting: real SENT without accepted evidence is rejected; definite restrictions release all Tokens', async () => {
    const f = await fixture();
    try {
        const c = await ownedReal(f), ticket = await ready(f, c), campaign = await admitReal(f, ticket);
        await expect(f.db.query("UPDATE outreach_deliveries SET state='SENT' WHERE campaign_id=$1", [campaign.id])).rejects.toHaveProperty('code');
        await f.db.query("UPDATE outreach_provider_fixtures SET scenario='RESTRICTED' WHERE channel_id=$1", [c.id]);
        expect(await drain(f, campaign.id)).toBe('COMPLETED_WITH_ERRORS');
        expect((await stats(f, c.id)).message_calls).toBe(1);
        expect((await ledger(f, campaign.id)).map(x => x.entry_type)).toEqual(['RELEASE', 'RESERVE']);
        await evidence('provider-restricted', { status: 'PASS', unprovenSentDenied: true, restrictedNotRetried: true, releasedTokens: 10, capturedTokens: 0 });
    }
    finally {
        await close(f);
    }
});

// Durable approval cannot bypass revoked membership.
test('O/authority: revoked approver and global Outreach disable prevent provider calls',async()=>{
 const f=await fixture();try{
  const c=await ownedReal(f),ticket=await ready(f,c),campaign=await admitReal(f,ticket),before=await stats(f,c.id);
  expect(invoke('tick',undefined,'','',{OUTREACH_ENABLED:'0'})).toEqual({processed:false});
  await f.db.query("UPDATE workspace_members SET role='VIEWER' WHERE workspace_id=$1",[f.workspaceId]);
  expect(invoke('tick')).toEqual({processed:false});expect(await stats(f,c.id)).toEqual(before);
  await f.db.query("UPDATE workspace_members SET role='OWNER' WHERE workspace_id=$1",[f.workspaceId]);
  expect(await drain(f,campaign.id)).toBe('COMPLETED');
  await evidence('provider-authority',{status:'PASS',revokedAuthorityPreventsCalls:true,globalOffPreventsCalls:true,externalMessages:0});
 }finally{await close(f);}
});

test('F/selection: multiple authorized shops require one owned selection and cannot replay',async()=>{
 const f=await fixture();try{
  const c=await ownedReal(f,'MULTI_SHOP');expect((await channel(f,c.id)).status).toBe('PENDING');
  expect(invoke('selection',f,c.id)).toEqual({choices:2,publicMetadataSafe:true,invalid:404,selected:200,replayed:409});
  expect((await channel(f,c.id)).status).toBe('CONNECTED');
  await evidence('provider-shop-selection',{status:'PASS',choices:2,explicitSelection:true,replayDenied:true,externalMessages:0});
 }finally{await close(f);}
});
test('D/key: refresh activates a new key version while the previous envelope remains immutable',async()=>{
 const f=await fixture();try{
  const c=await ownedReal(f);expect(invoke('refresh',f,c.id,'',{OUTREACH_CREDENTIAL_KEY_VERSION:'2'})).toEqual({refreshed:true});
  const keys=(await f.db.query('SELECT key_version FROM outreach_channel_credentials WHERE channel_id=$1 ORDER BY credential_version',[c.id])).rows.map(r=>r.key_version);expect(keys).toEqual([1,2]);
  expect(invoke('audit-storage',f,c.id)).toMatchObject({envelopeOnly:true,serverDecryption:true});
  await evidence('provider-key-lifecycle',{status:'PASS',keyVersions:[1,2],independentCredentialGenerations:true,historicalEnvelopeRetained:true,secretValuesEmitted:0});
 }finally{await close(f);}
});
test('J/claimed: disconnect before provider execution releases only definitely unsent work',async()=>{
 const f=await fixture();try{
  const c=await ownedReal(f),ticket=await ready(f,c),campaign=await admitReal(f,ticket);
  expect(invoke('disconnect-claimed',f,c.id)).toEqual({state:'FAILED'});expect((await stats(f,c.id)).message_calls).toBe(0);
  expect((await ledger(f,campaign.id)).map(r=>r.entry_type)).toEqual(['RELEASE','RESERVE']);
  expect((await f.c.get(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${campaign.id}`)).status()).toBe(200);
  await evidence('provider-disconnect-claimed',{status:'PASS',claimedBeforeDisconnect:true,definitelyUnsent:true,releasedTokens:10,externalMessages:0});
 }finally{await close(f);}
});
