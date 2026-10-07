import { test, expect } from '@playwright/test';
import { fixture, admit, close, evidence, launch, killOwned, marker, logWorker, invoke, ledger } from './support';
import { randomUUID } from 'node:crypto';
for (const stage of ['before_claim', 'after_claim', 'after_provider', 'after_completion']) {
    test(`F: kill actual Outreach worker ${stage}; durable recovery never duplicates a message or wallet entry`, async () => {
        const f = await fixture();
        let worker: ReturnType<typeof launch> | undefined, replacement: ReturnType<typeof launch> | undefined;
        try {
            const c = await admit(f, { targetCount: 1 });
            worker = launch(stage, `${stage}-${randomUUID()}`);
            await expect.poll(() => marker(worker!.dir), { timeout: 20000 }).not.toBeNull();
            const before = (await f.db.query('SELECT id,state,lease_id FROM outreach_deliveries WHERE campaign_id=$1', [c.id])).rows[0];
            if (stage === 'before_claim')
                expect(before.state).toBe('PENDING');
            if (stage === 'after_completion')
                expect(before.state).toBe('SENT');
            killOwned(worker.child);
            await logWorker(worker, `outreach-killed-${stage}`);
            replacement = launch('', `replacement-${stage}-${randomUUID()}`);
            if (stage === 'after_claim' || stage === 'after_provider') {
                await expect.poll(async () => (await f.db.query('SELECT state FROM outreach_campaigns WHERE id=$1', [c.id])).rows[0].state, { timeout: 20000 }).toBe('DELIVERY_UNKNOWN');
                expect(invoke('finish', [JSON.stringify(before)]).status).toBe(409);
                expect((await f.db.query('SELECT attempt_count FROM outreach_deliveries WHERE id=$1', [before.id])).rows[0].attempt_count).toBe(1);
                expect((await f.db.query('SELECT status FROM outreach_campaign_billing WHERE campaign_id=$1', [c.id])).rows[0].status).toBe('RESERVED');
                const check = await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/reconcile`, { data: {} });
                expect(check.status()).toBe(200);
                expect((await check.json()).resolved).toBe(1);
            }
            await expect.poll(async () => (await f.db.query('SELECT status FROM outreach_campaign_billing WHERE campaign_id=$1', [c.id])).rows[0].status, { timeout: 20000 }).toBe('SETTLED');
            expect((await f.db.query('SELECT state FROM outreach_campaigns WHERE id=$1', [c.id])).rows[0].state).toBe('COMPLETED');
            const receipt = (await f.db.query('SELECT call_count,simulated_sends FROM outreach_test_receipts WHERE delivery_id=$1', [before.id])).rows[0];
            expect(receipt).toEqual({ call_count: 1, simulated_sends: 1 });
            expect((await ledger(f, c.id)).map(r => [r.entry_type, r.count])).toEqual([['CAPTURE', 1], ['RESERVE', 1]]);
            await evidence(`outreach-crash-${stage}`, { status: 'PASS', actualProcessKilled: true, workerRestarted: true, oldLeaseRejected: ['after_claim', 'after_provider'].includes(stage), providerCalls: 1, simulatedSends: 1, singleReserve: true, singleCapture: true, realSends: 0 });
        }
        finally {
            killOwned(worker?.child);
            killOwned(replacement?.child);
            if (replacement)
                await logWorker(replacement, `outreach-restarted-${stage}`);
            await close(f);
        }
    });
}
for (const action of ['pause', 'cancel'] as const) {
    test(`Safe boundary: ${action} stops new claims while an already active delivery may finish`, async () => {
        const f = await fixture();
        let worker: ReturnType<typeof launch> | undefined;
        try {
            const c = await admit(f);
            worker = launch('after_claim', `${action}-${randomUUID()}`);
            await expect.poll(() => marker(worker!.dir), { timeout: 20000 }).not.toBeNull();
            const d = (await f.db.query("SELECT id,lease_id FROM outreach_deliveries WHERE campaign_id=$1 AND state='DISPATCHING'", [c.id])).rows[0];
            expect((await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/control`, { data: { action } })).status()).toBe(200);
            expect(invoke('finish', [JSON.stringify(d)]).finished).toBe(true);
            for (let n = 0; n < 2; n++)
                invoke('tick');
            expect(Number((await f.db.query('SELECT sum(simulated_sends) n FROM outreach_test_receipts WHERE channel_id=$1', [f.channel.id])).rows[0].n)).toBe(1);
            expect((await f.db.query('SELECT state FROM outreach_campaigns WHERE id=$1', [c.id])).rows[0].state).toBe(action === 'pause' ? 'PAUSED' : 'CANCELLED');
            if (action === 'pause')
                await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/control`, { data: { action: 'cancel' } });
            const b = (await f.db.query('SELECT captured_tokens,released_tokens FROM outreach_campaign_billing WHERE campaign_id=$1', [c.id])).rows[0];
            expect(b).toEqual({ captured_tokens: '10', released_tokens: '30' });
            await evidence(`outreach-inflight-${action}`, { status: 'PASS', activeDeliveryMayFinish: true, newClaimsStopped: true, sent: 1, unsent: 3, captured: 10, released: 30, realSends: 0 });
        }
        finally {
            killOwned(worker?.child);
            if (worker)
                await logWorker(worker, `outreach-inflight-${action}`);
            await close(f);
        }
    });
}
