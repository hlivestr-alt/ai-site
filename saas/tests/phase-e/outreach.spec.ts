import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fixture, admit, quote, drain, ledger, close, invoke, evidence } from './support';
import { login } from '../stabilization/browser-checks';
test('A/B: one-click frozen TEST campaign and concurrent replay make one campaign, snapshot, reservation and send per recipient', async () => { const f = await fixture(); try {
    const c = await admit(f);
    const replies = await Promise.all(Array.from({ length: 5 }, () => f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns`, { data: c.input })));
    for (const r of replies) {
        expect(r.status()).toBe(201);
        expect((await r.json()).campaign.id).toBe(c.id);
    }
    expect(await drain(f, c.id)).toBe('COMPLETED');
    expect(await ledger(f, c.id)).toEqual([{ entry_type: 'CAPTURE', count: 1, available: '0', reserved: '-40' }, { entry_type: 'RESERVE', count: 1, available: '-40', reserved: '40' }]);
    for (const table of ['outreach_recipients', 'outreach_deliveries', 'outreach_outbox'])
        expect(Number((await f.db.query(`SELECT count(*) n FROM ${table} WHERE campaign_id=$1`, [c.id])).rows[0].n)).toBe(4);
    expect(Number((await f.db.query('SELECT sum(simulated_sends) n FROM outreach_test_receipts WHERE delivery_id IN(SELECT id FROM outreach_deliveries WHERE campaign_id=$1)', [c.id])).rows[0].n)).toBe(4);
    invoke('tick');
    expect((await f.db.query('SELECT count(*)::int n FROM outreach_campaigns WHERE workspace_id=$1', [f.workspaceId])).rows[0].n).toBe(1);
    await evidence('outreach-basic-idempotency', { status: 'PASS', campaigns: 1, versions: 1, recipients: 4, deliveries: 4, simulatedSends: 4, RESERVE: 1, CAPTURE: 1, realSends: 0 });
}
finally {
    await close(f);
} });
test('C/L: mixed outcomes keep exact counts, hold unknown Tokens, refuse arbitrary resolution and reconcile provider proof once', async () => { const f = await fixture(); try {
    await f.db.query("UPDATE outreach_creators SET test_outcome=CASE creator_key WHEN 'qa_creator_012' THEN 'UNKNOWN_SENT' WHEN 'qa_creator_011' THEN 'RESTRICTED' WHEN 'qa_creator_010' THEN 'FAILED' ELSE 'SENT' END WHERE channel_id=$1", [f.channel.id]);
    const c = await admit(f);
    expect(await drain(f, c.id)).toBe('DELIVERY_UNKNOWN');
    for (let i = 0; i < 3; i++)
        invoke('tick');
    expect(Number((await f.db.query('SELECT sum(call_count) n FROM outreach_test_receipts WHERE channel_id=$1', [f.channel.id])).rows[0].n)).toBe(1);
    expect((await f.db.query('SELECT status FROM outreach_campaign_billing WHERE campaign_id=$1', [c.id])).rows[0].status).toBe('RESERVED');
    expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/reconcile`, { data: { status: 'SENT' } })).status()).toBe(400);
    const resolved = await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/reconcile`, { data: {} });
    expect(resolved.status()).toBe(200);
    expect((await resolved.json()).resolved).toBe(1);
    expect(await drain(f, c.id)).toBe('COMPLETED_WITH_ERRORS');
    const detail = (await (await f.c.get(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}`)).json()).campaign;
    expect(detail.counts).toMatchObject({ sent: 2, restricted: 1, failed: 1, unknown: 0, remaining: 0 });
    expect(detail.billing).toMatchObject({ capturedTokens: '20', releasedTokens: '20', status: 'SETTLED' });
    expect((await ledger(f, c.id)).map(r => [r.entry_type, r.count])).toEqual([['CAPTURE', 1], ['RELEASE', 1], ['RESERVE', 1]]);
    await evidence('outreach-mixed-unknown', { status: 'PASS', sent: 2, restricted: 1, failed: 1, unknownBeforeReconciliation: 1, noBlindRetry: true, arbitraryBrowserResolutionRejected: true, providerProofRequired: true, reserved: 40, captured: 20, released: 20, realSends: 0 });
}
finally {
    await close(f);
} });
test('L: unresolved provider status retains reservation and exclusion until confirmed NOT_SENT evidence permits one safe retry', async () => { const f = await fixture(); try {
    await f.db.query("UPDATE outreach_creators SET test_outcome='UNKNOWN_PENDING' WHERE creator_key='qa_creator_012' AND channel_id=$1", [f.channel.id]);
    const c = await admit(f, { targetCount: 1 });
    expect(await drain(f, c.id)).toBe('DELIVERY_UNKNOWN');
    expect((await (await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/reconcile`, { data: {} })).json()).resolved).toBe(0);
    expect((await quote(f.c, f.workspaceId, { ...f.config, targetCount: 1 })).summary.excluded.DELIVERY_UNKNOWN).toBe(1);
    for (let n = 0; n < 2; n++)
        invoke('tick');
    const d = (await f.db.query('SELECT id,attempt_count FROM outreach_deliveries WHERE campaign_id=$1', [c.id])).rows[0];
    expect(d.attempt_count).toBe(1);
    await f.db.query("UPDATE outreach_test_receipts SET status='NOT_SENT',updated_at=now() WHERE delivery_id=$1", [d.id]);
    await f.db.query("UPDATE outreach_creators SET test_outcome='SENT' WHERE creator_key='qa_creator_012' AND channel_id=$1", [f.channel.id]);
    expect((await (await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/reconcile`, { data: {} })).json()).resolved).toBe(1);
    expect(await drain(f, c.id)).toBe('COMPLETED');
    expect((await f.db.query('SELECT attempt_count FROM outreach_deliveries WHERE id=$1', [d.id])).rows[0].attempt_count).toBe(2);
    expect(Number((await f.db.query('SELECT simulated_sends FROM outreach_test_receipts WHERE delivery_id=$1', [d.id])).rows[0].simulated_sends)).toBe(1);
    await evidence('outreach-unknown-not-sent', { status: 'PASS', heldUntilProof: true, unresolvedExcluded: true, proofAllowsRetry: true, attempts: 2, simulatedSends: 1 });
}
finally {
    await close(f);
} });
test('D: pause stops new dispatch, resume continues frozen remaining recipients without duplicates', async () => { const f = await fixture(); try {
    const c = await admit(f);
    invoke('tick');
    expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/control`, { data: { action: 'pause' } })).status()).toBe(200);
    for (let n = 0; n < 3; n++)
        invoke('tick');
    expect(Number((await f.db.query('SELECT sum(simulated_sends) n FROM outreach_test_receipts WHERE channel_id=$1', [f.channel.id])).rows[0].n)).toBe(1);
    expect((await f.db.query('SELECT state FROM outreach_campaigns WHERE id=$1', [c.id])).rows[0].state).toBe('PAUSED');
    expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/control`, { data: { action: 'resume' } })).status()).toBe(200);
    expect(await drain(f, c.id)).toBe('COMPLETED');
    expect(Number((await f.db.query('SELECT sum(simulated_sends) n FROM outreach_test_receipts WHERE channel_id=$1', [f.channel.id])).rows[0].n)).toBe(4);
    await evidence('outreach-pause-resume', { status: 'PASS', sentBeforePause: 1, sentWhilePaused: 1, sentAfterResume: 4, noDuplicates: true });
}
finally {
    await close(f);
} });
test('E: cancel before dispatch releases all; partial cancellation charges only confirmed sends', async () => { const f = await fixture(); try {
    const first = await admit(f);
    expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${first.id}/control`, { data: { action: 'cancel' } })).status()).toBe(200);
    expect((await ledger(f, first.id)).map(r => [r.entry_type, r.reserved])).toEqual([['RELEASE', '-40'], ['RESERVE', '40']]);
    const second = await admit(f);
    invoke('tick');
    expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${second.id}/control`, { data: { action: 'cancel' } })).status()).toBe(200);
    invoke('tick');
    const b = (await f.db.query('SELECT captured_tokens,released_tokens FROM outreach_campaign_billing WHERE campaign_id=$1', [second.id])).rows[0];
    expect(b).toEqual({ captured_tokens: '10', released_tokens: '30' });
    expect((await f.db.query('SELECT state,count(*)::int n FROM outreach_deliveries WHERE campaign_id=$1 GROUP BY state ORDER BY state', [second.id])).rows).toEqual([{ state: 'CANCELLED', n: 3 }, { state: 'SENT', n: 1 }]);
    await evidence('outreach-cancel-accounting', { status: 'PASS', beforeSend: { captured: 0, released: 40 }, partial: { sent: 1, cancelled: 3, captured: 10, released: 30 }, sentHistoryPreserved: true });
}
finally {
    await close(f);
} });
test('retry/pacing: only definitive temporary failures retry, attempts are bounded and never reserve twice', async () => { const f = await fixture(); try {
    await f.db.query("UPDATE outreach_creators SET test_outcome='RETRY_ONCE' WHERE creator_key='qa_creator_012' AND channel_id=$1", [f.channel.id]);
    const c = await admit(f, { targetCount: 1 });
    expect(await drain(f, c.id)).toBe('COMPLETED');
    const a = (await f.db.query('SELECT attempt_count FROM outreach_deliveries WHERE campaign_id=$1', [c.id])).rows[0];
    expect(a.attempt_count).toBe(2);
    await f.db.query("UPDATE outreach_creators SET test_outcome='RETRY_ALWAYS' WHERE channel_id=$1 AND creator_key='qa_creator_011'", [f.channel.id]);
    const fail = await admit(f, { targetCount: 1 });
    expect(await drain(f, fail.id)).toBe('FAILED');
    expect((await f.db.query('SELECT attempt_count FROM outreach_deliveries WHERE campaign_id=$1', [fail.id])).rows[0].attempt_count).toBe(3);
    expect((await ledger(f, fail.id)).map(r => [r.entry_type, r.count])).toEqual([['RELEASE', 1], ['RESERVE', 1]]);
    await evidence('outreach-retry-bounds', { status: 'PASS', temporaryAttempts: 2, boundedFailureAttempts: 3, singleReservation: true, pacingMs: 1000, noRealSends: true });
}
finally {
    await close(f);
} });
test('G/H/I: shared wallet never shares channels, campaign/message/delivery/attempt/audit IDs or control permissions', async () => { const f = await fixture(), other = await fixture(); let cb; try {
    const r = await f.c.post('/api/workspaces', { data: { name: 'Shared Outreach Brand B' } });
    expect(r.status()).toBe(201);
    const w = (await r.json()).workspace.id;
    cb = await login(f.email);
    expect((await cb.post(`/api/workspaces/${w}/select`)).status()).toBe(200);
    const c = await admit(f);
    expect(await drain(f, c.id)).toBe('COMPLETED');
    const a = (await (await f.c.get(`/api/workspaces/${f.workspaceId}/billing`)).json()).wallet, b = (await (await cb.get(`/api/workspaces/${w}/billing`)).json()).wallet, y = (await (await other.c.get(`/api/workspaces/${other.workspaceId}/billing`)).json()).wallet;
    expect(a.billingAccountId).toBe(b.billingAccountId);
    expect(a).toMatchObject({ availableTokens: '960', reservedTokens: '0' });
    expect(b.availableTokens).toBe('960');
    expect(y.billingAccountId).not.toBe(a.billingAccountId);
    expect(y.availableTokens).toBe('1000');
    const recipient = (await f.db.query('SELECT id FROM outreach_recipients WHERE campaign_id=$1 LIMIT 1', [c.id])).rows[0].id, d = (await f.db.query('SELECT id FROM outreach_deliveries WHERE recipient_id=$1', [recipient])).rows[0].id, attempt = (await f.db.query('SELECT id FROM outreach_delivery_attempts WHERE delivery_id=$1', [d])).rows[0].id;
    const prefix = `/api/workspaces/${w}/outreach`;
    for (const path of [`channels/${f.channel.id}`, `campaigns/${c.id}`, `campaigns/${c.id}/recipients`, `campaigns/${c.id}/recipients/${recipient}/message`, `campaigns/${c.id}/deliveries/${d}`, `campaigns/${c.id}/deliveries/${d}/attempts/${attempt}`, `campaigns/${c.id}/audit`])
        expect((await cb.get(`${prefix}/${path}`)).status()).toBe(404);
    for (const action of ['pause', 'resume', 'cancel'])
        expect((await cb.post(`${prefix}/campaigns/${c.id}/control`, { data: { action } })).status()).toBe(404);
    expect((await cb.post(`/api/workspaces/${w}/billing/quotes`, { data: { operation: 'OUTREACH', ...f.config } })).status()).toBe(404);
    expect((await cb.get(`${prefix}/campaigns`)).status()).toBe(200);
    expect((await (await cb.get(`${prefix}/campaigns`)).json()).campaigns).toEqual([]);
    for (const bad of [{ provider: 'INTERNAL', label: 'Internal' }, { provider: 'TEST', label: 'Internal', nativeConnectionId: randomUUID() }])
        expect((await cb.post(`${prefix}/channels`, { data: bad })).status()).toBe(400);
    await evidence('outreach-wallet-isolation', { status: 'PASS', sharedAvailable: 960, otherAccountAvailable: 1000, foreignReadsDenied: 7, foreignControlsDenied: 3, foreignQuoteDenied: true, internalSenderRejected: true, noImportedNativeHistory: true });
}
finally {
    await cb?.dispose();
    await close(f);
    await close(other);
} });
test('J/concurrency: insufficient/stale quotes and parallel campaigns cannot overspend the shared account', async () => { const f = await fixture('30'); try {
    const second = (await (await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/channels`, { data: { provider: 'TEST', label: 'Second controlled account' } })).json()).channel;
    const c1 = { ...f.config, targetCount: 2 }, c2 = { ...c1, channelId: second.id, name: 'Second concurrent campaign' }, q1 = await quote(f.c, f.workspaceId, c1), q2 = await quote(f.c, f.workspaceId, c2);
    const replies = await Promise.all([[c1, q1], [c2, q2]].map(([config, q]) => f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns`, { data: { ...config, idempotencyKey: randomUUID(), quoteId: q.id, quoteHash: q.quoteHash } })));
    expect(replies.map(r => r.status()).sort()).toEqual([201, 402]);
    const insufficient = await quote(f.c, f.workspaceId, { ...f.config, targetCount: 4 });
    expect(insufficient.affordable).toBe(false);
    const wallet = (await f.db.query('SELECT available_tokens,reserved_tokens FROM billing_account_wallets WHERE billing_account_id=(SELECT billing_account_id FROM workspaces WHERE id=$1)', [f.workspaceId])).rows[0];
    expect(wallet).toEqual({ available_tokens: '10', reserved_tokens: '20' });
    expect(Number((await f.db.query('SELECT count(*) n FROM outreach_campaigns WHERE workspace_id=$1', [f.workspaceId])).rows[0].n)).toBe(1);
    await evidence('outreach-concurrency', { status: 'PASS', responses: [201, 402], available: 10, reserved: 20, campaigns: 1, noNegativeWallet: true });
}
finally {
    await close(f);
} });
test('K/freeze: cooldown, do-not-contact and active reservations apply; frozen recipient/message survive directory changes', async () => { const f = await fixture(); try {
    const c = await admit(f, { targetCount: 2 });
    const rows = (await f.db.query('SELECT id,frozen_message,safe_snapshot FROM outreach_recipients WHERE campaign_id=$1 ORDER BY rank', [c.id])).rows;
    await f.db.query("UPDATE outreach_creators SET display_name='Changed QA creator',followers=900000 WHERE channel_id=$1 AND creator_key='qa_creator_012'", [f.channel.id]);
    expect((await f.db.query('SELECT frozen_message,safe_snapshot FROM outreach_recipients WHERE id=$1', [rows[0].id])).rows[0]).toEqual({ frozen_message: rows[0].frozen_message, safe_snapshot: rows[0].safe_snapshot });
    await expect(f.db.query("UPDATE outreach_recipients SET frozen_message='Rewrite' WHERE id=$1", [rows[0].id])).rejects.toMatchObject({ code: '23514' });
    expect(await drain(f, c.id)).toBe('COMPLETED');
    await f.db.query("INSERT INTO outreach_contact_state(workspace_id,channel_id,creator_key,do_not_contact) VALUES($1,$2,'qa_creator_010',true)", [f.workspaceId, f.channel.id]);
    const q = await quote(f.c, f.workspaceId, { ...f.config, targetCount: 1 });
    expect(q.summary.excluded).toMatchObject({ COOLDOWN: 2, DO_NOT_CONTACT: 1 });
    const next = await admit(f, { targetCount: 1 });
    const preview = await quote(f.c, f.workspaceId, { ...f.config, targetCount: 1 });
    expect(preview.summary.excluded.ACTIVE_RESERVATION).toBe(1);
    expect((await f.db.query('SELECT creator_key FROM outreach_recipients WHERE campaign_id=$1', [next.id])).rows[0].creator_key).toBe('qa_creator_009');
    await evidence('outreach-freeze-cooldown', { status: 'PASS', frozenSnapshotUnchanged: true, immutableMessage: true, cooldownExcluded: 2, doNotContactExcluded: 1, activeReservationExcluded: 1, scope: 'Workspace-owned channel' });
}
finally {
    await close(f);
} });
test('permissions/validation: editor/viewer cannot send/manage channels, invalid configuration never reserves, disconnected sender denies admission', async () => { const f = await fixture(); try {
    for (const patch of [{ nativeSenderId: randomUUID() }, { messageTemplate: '{{process.env.SECRET}}' }, { targetCount: 501 }, { filters: { minFollowers: 10, maxFollowers: 1 } }])
        expect((await f.c.post(`/api/workspaces/${f.workspaceId}/billing/quotes`, { data: { operation: 'OUTREACH', ...f.config, ...patch } })).status()).toBe(400);
    const user = (await f.db.query('SELECT user_id FROM workspace_members WHERE workspace_id=$1', [f.workspaceId])).rows[0].user_id;
    for (const role of ['EDITOR', 'VIEWER']) {
        await f.db.query('UPDATE workspace_members SET role=$1 WHERE workspace_id=$2 AND user_id=$3', [role, f.workspaceId, user]);
        expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns`, { data: { ...f.config, idempotencyKey: randomUUID() } })).status()).toBe(403);
        expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/channels`, { data: { provider: 'TEST', label: 'Unauthorized' } })).status()).toBe(403);
        expect((await f.c.get(`/api/workspaces/${f.workspaceId}/outreach/channels`)).status()).toBe(200);
    }
    await f.db.query("UPDATE workspace_members SET role='OWNER' WHERE workspace_id=$1 AND user_id=$2", [f.workspaceId, user]);
    const q = await quote(f.c, f.workspaceId, f.config);
    expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/channels/${f.channel.id}`, { data: { action: 'disconnect' } })).status()).toBe(200);
    expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns`, { data: { ...f.config, idempotencyKey: randomUUID(), quoteId: q.id, quoteHash: q.quoteHash } })).status()).toBe(409);
    expect(Number((await f.db.query('SELECT count(*) n FROM outreach_campaigns WHERE workspace_id=$1', [f.workspaceId])).rows[0].n)).toBe(0);
    await evidence('outreach-permissions-validation', { status: 'PASS', viewerSendDenied: true, editorSendDenied: true, channelManageDenied: true, invalidInputsReserveNothing: true, disconnectRejectsStaleQuote: true });
}
finally {
    await close(f);
} });
test('database safety: terminal shortcuts, blind unknown retry, sender reassignment and changed operation settings are rejected', async () => {
    const f = await fixture();
    try {
        const c = await admit(f, { targetCount: 1 });
        const d = (await f.db.query('SELECT id FROM outreach_deliveries WHERE campaign_id=$1', [c.id])).rows[0];
        await expect(f.db.query("UPDATE outreach_deliveries SET state='SENT' WHERE id=$1", [d.id])).rejects.toMatchObject({ code: 'P0001' });
        await expect(f.db.query("UPDATE outreach_campaigns SET state='COMPLETED' WHERE id=$1", [c.id])).rejects.toMatchObject({ code: 'P0001' });
        await expect(f.db.query("UPDATE outreach_channels SET provider='TIKTOK_SHOP' WHERE id=$1", [f.channel.id])).rejects.toMatchObject({ code: 'P0001' });
        expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns`, { data: { ...c.input, name: 'Changed operation' } })).status()).toBe(409);
        await f.db.query("UPDATE outreach_creators SET test_outcome='UNKNOWN_PENDING' WHERE channel_id=$1 AND creator_key='qa_creator_012'", [f.channel.id]);
        expect(await drain(f, c.id)).toBe('DELIVERY_UNKNOWN');
        await expect(f.db.query("UPDATE outreach_deliveries SET state='RETRYABLE' WHERE id=$1", [d.id])).rejects.toMatchObject({ code: 'P0001' });
        await expect(f.db.query("UPDATE outreach_deliveries SET state='SENT' WHERE id=$1", [d.id])).rejects.toMatchObject({ code: 'P0001' });
        await f.db.query("UPDATE outreach_test_receipts SET status='NOT_SENT' WHERE delivery_id=$1", [d.id]);
        expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/control`, { data: { action: 'cancel' } })).status()).toBe(200);
        expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/reconcile`, { data: {} })).status()).toBe(200);
        expect((await f.db.query('SELECT state FROM outreach_campaigns WHERE id=$1', [c.id])).rows[0].state).toBe('CANCELLED');
        await evidence('outreach-database-safety', { status: 'PASS', invalidTransitionsRejected: true, proofRequiredByDatabase: true, immutableSenderIdentity: true, changedOperationConflict: true });
    }
    finally {
        await close(f);
    }
});
test('Dispatch authorization: recheck do-not-contact after freeze, honor provider rate-limit delay and reconcile an inactive channel without sending', async () => {
    const f = await fixture();
    try {
        const first = await admit(f, { targetCount: 1 });
        await f.db.query("INSERT INTO outreach_contact_state(workspace_id,channel_id,creator_key,do_not_contact) VALUES($1,$2,'qa_creator_012',true)", [f.workspaceId, f.channel.id]);
        expect(await drain(f, first.id)).toBe('FAILED');
        expect((await f.db.query('SELECT count(*)::int n FROM outreach_test_receipts WHERE channel_id=$1', [f.channel.id])).rows[0].n).toBe(0);
        await f.db.query("UPDATE outreach_creators SET test_outcome='RATE_LIMIT' WHERE channel_id=$1 AND creator_key='qa_creator_011'", [f.channel.id]);
        const limited = await admit(f, { targetCount: 1 });
        expect(await drain(f, limited.id)).toBe('COMPLETED');
        const attempts = (await f.db.query('SELECT a.safe_code,extract(epoch FROM a.started_at)*1000 time FROM outreach_delivery_attempts a JOIN outreach_deliveries d ON d.id=a.delivery_id WHERE d.campaign_id=$1 ORDER BY a.attempt_number', [limited.id])).rows;
        expect(attempts[0].safe_code).toBe('TEST_RATE_LIMIT');
        expect(Number(attempts[1].time) - Number(attempts[0].time)).toBeGreaterThanOrEqual(1000);
        await f.db.query("UPDATE outreach_creators SET test_outcome='UNKNOWN_SENT' WHERE channel_id=$1 AND creator_key='qa_creator_010'", [f.channel.id]);
        const unknown = await admit(f, { targetCount: 1 });
        expect(await drain(f, unknown.id)).toBe('DELIVERY_UNKNOWN');
        expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/channels/${f.channel.id}`, { data: { action: 'disconnect' } })).status()).toBe(200);
        expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${unknown.id}/reconcile`, { data: {} })).status()).toBe(200);
        expect((await f.db.query('SELECT status,captured_tokens FROM outreach_campaign_billing WHERE campaign_id=$1', [unknown.id])).rows[0]).toEqual({ status: 'SETTLED', captured_tokens: '10' });
        await evidence('outreach-dispatch-authority', { status: 'PASS', eligibilityRecheckedBeforeDispatch: true, blockedBeforeProviderCall: true, rateLimitRespected: true, disconnectedStatusReconciliationReadOnly: true, realSends: 0 });
    }
    finally {
        await close(f);
    }
});

test('Frozen set: no later recipient/intent can be appended to an admitted campaign', async()=>{
 const f=await fixture();try{
  const c=await admit(f,{targetCount:1});
  await expect(f.db.query("INSERT INTO outreach_recipients(workspace_id,campaign_id,channel_id,version_id,creator_key,safe_snapshot,frozen_message,message_hash,rank) SELECT workspace_id,campaign_id,channel_id,version_id,'later_creator','{}'::jsonb,'Changed frozen set',message_hash,2 FROM outreach_recipients WHERE campaign_id=$1 LIMIT 1",[c.id])).rejects.toMatchObject({code:'P0001'});
  expect((await f.db.query('SELECT count(*)::int n FROM outreach_recipients WHERE campaign_id=$1',[c.id])).rows[0].n).toBe(1);
  await evidence('outreach-frozen-set',{status:'PASS',postAdmissionAppendRejected:true,recipientCountUnchanged:true});
 }finally{await close(f);}
});
