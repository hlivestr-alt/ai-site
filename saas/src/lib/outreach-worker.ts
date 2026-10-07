import 'server-only';
import { randomUUID } from 'node:crypto';
import { query, transaction, type DbClient } from './db';
import { AppError, audit } from './core';
import { canonicalHash } from './billing-core';
import type { Session } from './auth';
import { requireActiveWorkspace } from './products';
import { channelFor, requireOutbound, campaignFor, refreshCampaign, settleCampaign, testOutreachEnabled } from './outreach';
import type { DeliveryState } from './outreach-core';
import { providerConfiguration, realChannel, realChannelSendable, recoverConnectionHealth } from './outreach-provider';
import { validateCanary } from './outreach-canary';
import { sendOwnedProvider, updateCanaryOutcome } from './outreach-provider-execution';
export type ClaimedDelivery = {
    id: string;
    workspace_id: string;
    campaign_id: string;
    channel_id: string;
    recipient_id: string;
    creator_key: string;
    attempt_count: number;
    lease_id: string;
    lease_expires_at: Date;
    state: DeliveryState;
    frozen_message: string;
    message_hash: string;
};
export type ProviderOutcome = {
    state: 'SENT' | 'RESTRICTED' | 'FAILED' | 'RETRYABLE' | 'DELIVERY_UNKNOWN';
    code: string;
    retryAfterMs?: number;
};
function requireTest() {
    if (!testOutreachEnabled())
        throw new AppError(503, 'The isolated Outreach test provider is unavailable.');
}
export function outreachWorkerEnabled() { return testOutreachEnabled() || providerConfiguration().configured; }
function requireWorker() { if (!outreachWorkerEnabled())
    throw new AppError(503, 'Outreach provider activation is pending.'); }
export async function outreachHeartbeat(workerId: string) { requireWorker(); await query("INSERT INTO outreach_channel_health(workspace_id,channel_id,worker_id,last_seen_at) SELECT workspace_id,id,$1,now() FROM outreach_channels WHERE ((provider='TEST' AND $2) OR (provider='TIKTOK_SHOP' AND $3)) AND status='CONNECTED' ON CONFLICT(channel_id) DO UPDATE SET worker_id=excluded.worker_id,last_seen_at=excluded.last_seen_at", [workerId, testOutreachEnabled(), providerConfiguration().configured]); }
async function contactOutcome(db: DbClient, d: ClaimedDelivery, state: DeliveryState) {
    if (state === 'DELIVERY_UNKNOWN') {
        await db.query('INSERT INTO outreach_contact_state(workspace_id,channel_id,creator_key,unknown_delivery_id,last_delivery_id) VALUES($1,$2,$3,$4,$4) ON CONFLICT(channel_id,creator_key) DO UPDATE SET unknown_delivery_id=$4,last_delivery_id=$4,updated_at=now()', [d.workspace_id, d.channel_id, d.creator_key, d.id]);
        return;
    }
    if (state === 'SENT')
        await db.query('INSERT INTO outreach_contact_state(workspace_id,channel_id,creator_key,last_contacted_at,last_delivery_id,contact_count) VALUES($1,$2,$3,now(),$4,1) ON CONFLICT(channel_id,creator_key) DO UPDATE SET last_contacted_at=now(),last_delivery_id=$4,unknown_delivery_id=NULL,contact_count=outreach_contact_state.contact_count+1,updated_at=now()', [d.workspace_id, d.channel_id, d.creator_key, d.id]);
    else
        await db.query('UPDATE outreach_contact_state SET unknown_delivery_id=NULL,updated_at=now() WHERE channel_id=$1 AND creator_key=$2 AND unknown_delivery_id=$3', [d.channel_id, d.creator_key, d.id]);
    if (state !== 'RETRYABLE')
        await db.query('DELETE FROM outreach_reservations WHERE delivery_id=$1', [d.id]);
}
export async function recoverOutreachLeases() {
    requireWorker();
    await recoverConnectionHealth();
    const expired = (await query<{
        id: string;
        workspace_id: string;
        channel_id: string;
        campaign_id: string;
    }>("SELECT id,workspace_id,channel_id,campaign_id FROM outreach_deliveries WHERE state='DISPATCHING' AND lease_expires_at<=now() ORDER BY lease_expires_at LIMIT 50")).rows;
    let recovered = 0;
    for (const e of expired)
        await transaction(async (db) => {
            const recoveredChannel = await channelFor(db, e.workspace_id, e.channel_id, true);
            const c = await campaignFor(db, e.workspace_id, e.campaign_id, true);
            const d = (await db.query<ClaimedDelivery>("SELECT * FROM outreach_deliveries WHERE id=$1 AND state='DISPATCHING' AND lease_expires_at<=now() FOR UPDATE", [e.id])).rows[0];
            if (!d)
                return;
            await db.query("UPDATE outreach_deliveries SET state='DELIVERY_UNKNOWN',lease_id=NULL,lease_expires_at=NULL,last_code='WORKER_LEASE_LOST',updated_at=now() WHERE id=$1", [d.id]);
            await db.query("UPDATE outreach_delivery_attempts SET state='DELIVERY_UNKNOWN',safe_code='WORKER_LEASE_LOST',finished_at=now() WHERE delivery_id=$1 AND attempt_number=$2 AND state='STARTED'", [d.id, d.attempt_count]);
            await db.query("UPDATE outreach_outbox SET state='COMPLETED',updated_at=now() WHERE delivery_id=$1", [d.id]);
            await contactOutcome(db, d, 'DELIVERY_UNKNOWN');
            if (recoveredChannel.provider !== 'TEST')
                await updateCanaryOutcome(d, 'DELIVERY_UNKNOWN', db);
            await refreshCampaign(db, c);
            await audit(db, { workspaceId: d.workspace_id, billingAccountId: c.billing_account_id, type: 'OUTREACH_DELIVERY_UNKNOWN', targetType: 'outreach_campaign', targetId: c.id, metadata: { reason: 'WORKER_LEASE_LOST' } });
            recovered++;
        });
    return recovered;
}
export async function claimOutreach() {
    requireWorker();
    const candidates = (await query<{
        id: string;
        workspace_id: string;
    }>("SELECT c.id,c.workspace_id FROM outreach_channels c JOIN workspaces w ON w.id=c.workspace_id WHERE ((c.provider='TEST' AND $1) OR (c.provider='TIKTOK_SHOP' AND $2 AND c.access_expires_at>now()+interval '30 seconds' AND c.refresh_lease IS NULL AND (c.provider_blocked_until IS NULL OR c.provider_blocked_until<=now()))) AND c.status='CONNECTED' AND c.outbound_capable AND c.next_send_at<=now() AND w.status='ACTIVE' AND EXISTS(SELECT 1 FROM outreach_outbox o JOIN outreach_deliveries d ON d.id=o.delivery_id JOIN outreach_campaigns p ON p.id=d.campaign_id WHERE d.channel_id=c.id AND o.state='PENDING' AND o.available_at<=now() AND d.state IN('PENDING','RETRYABLE') AND p.state IN('QUEUED','SENDING') AND p.paused_at IS NULL AND p.cancel_requested_at IS NULL) ORDER BY c.next_send_at,c.id LIMIT 20", [testOutreachEnabled(), providerConfiguration().realSending])).rows;
    for (const candidate of candidates) {
        const claimed = await transaction(async (db) => {
            const channel = await channelFor(db, candidate.workspace_id, candidate.id, true);
            if (channel.provider !== 'TEST' && !realChannelSendable(channel as import('./outreach-provider').RealChannel))
                return null;
            requireOutbound(channel);
            if (channel.next_send_at.getTime() > Date.now() || (await db.query("SELECT id FROM outreach_deliveries WHERE channel_id=$1 AND state='DISPATCHING' LIMIT 1", [channel.id])).rowCount)
                return null;
            const row = (await db.query<ClaimedDelivery>(`SELECT d.*,r.frozen_message,r.message_hash FROM outreach_outbox o JOIN outreach_deliveries d ON d.id=o.delivery_id AND d.workspace_id=o.workspace_id JOIN outreach_campaigns c ON c.id=d.campaign_id AND c.workspace_id=d.workspace_id JOIN outreach_recipients r ON r.id=d.recipient_id AND r.workspace_id=d.workspace_id WHERE d.workspace_id=$1 AND d.channel_id=$2 AND o.state='PENDING' AND o.available_at<=now() AND d.available_at<=now() AND d.state IN('PENDING','RETRYABLE') AND c.state IN('QUEUED','SENDING') AND c.paused_at IS NULL AND c.cancel_requested_at IS NULL ORDER BY o.available_at,c.created_at,c.id,r.rank,o.id FOR UPDATE OF d,o SKIP LOCKED LIMIT 1`, [channel.workspace_id, channel.id])).rows[0];
            if (!row)
                return null;
            const c = await campaignFor(db, row.workspace_id, row.campaign_id, true);
            if (channel.provider !== 'TEST') {
                try {
                    await validateCanary(db, channel as import('./outreach-provider').RealChannel, c.config_snapshot, true);
                }
                catch {
                    return null;
                }
            }
            const contact = (await db.query<{
                do_not_contact: boolean;
                unknown_delivery_id: string | null;
                last_delivery_id: string | null;
                last_contacted_at: Date | null;
            }>('SELECT * FROM outreach_contact_state WHERE channel_id=$1 AND creator_key=$2', [row.channel_id, row.creator_key])).rows[0];
            const reservation = (await db.query('SELECT delivery_id FROM outreach_reservations WHERE channel_id=$1 AND creator_key=$2 AND workspace_id=$3', [row.channel_id, row.creator_key, row.workspace_id])).rows[0];
            const blocked = contact?.do_not_contact || (contact?.unknown_delivery_id && contact.unknown_delivery_id !== row.id) || (contact?.last_contacted_at && contact.last_delivery_id !== row.id && contact.last_contacted_at.getTime() > Date.now() - c.config_snapshot.cooldownDays * 86400000) || reservation?.delivery_id !== row.id;
            if (blocked || row.attempt_count >= 3) {
                await db.query("UPDATE outreach_deliveries SET state='FAILED',last_code=$1,finished_at=now(),updated_at=now() WHERE id=$2", [blocked ? 'ELIGIBILITY_CHANGED' : 'RETRY_LIMIT', row.id]);
                await db.query("UPDATE outreach_outbox SET state='COMPLETED',updated_at=now() WHERE delivery_id=$1", [row.id]);
                await contactOutcome(db, row, 'FAILED');
                await refreshCampaign(db, c);
                return null;
            }
            const leaseId = randomUUID(), seconds = Number(process.env.OUTREACH_LEASE_SECONDS || 60);
            if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300)
                throw new AppError(503, 'Outreach lease configuration is invalid.');
            const d = (await db.query<ClaimedDelivery>("UPDATE outreach_deliveries SET state='DISPATCHING',attempt_count=attempt_count+1,lease_id=$1,lease_expires_at=now()+$2*interval '1 second',started_at=coalesce(started_at,now()),updated_at=now() WHERE id=$3 RETURNING *", [leaseId, seconds, row.id])).rows[0];
            await db.query("UPDATE outreach_outbox SET state='CLAIMED',updated_at=now() WHERE delivery_id=$1", [row.id]);
            await db.query('INSERT INTO outreach_delivery_attempts(workspace_id,delivery_id,attempt_number,lease_id) VALUES($1,$2,$3,$4)', [d.workspace_id, d.id, d.attempt_count, leaseId]);
            await db.query("UPDATE outreach_campaigns SET state='SENDING',started_at=coalesce(started_at,now()),updated_at=now() WHERE id=$1", [c.id]);
            await db.query("UPDATE outreach_channels SET next_send_at=now()+send_interval_ms*interval '1 millisecond',updated_at=now() WHERE id=$1", [channel.id]);
            return { ...d, frozen_message: row.frozen_message, message_hash: row.message_hash };
        });
        if (claimed)
            return claimed;
    }
    return null;
}
// The fake provider has its own durable transaction. A lost response never erases its proof.
// TEST receipts remain confined to the owned synthetic provider.
export async function fakeSend(d: ClaimedDelivery): Promise<ProviderOutcome> {
    requireTest();
    return transaction(async (db) => {
        const c = await channelFor(db, d.workspace_id, d.channel_id, true);
        requireOutbound(c);
        const row = (await db.query<ClaimedDelivery>("SELECT d.*,r.frozen_message,r.message_hash FROM outreach_deliveries d JOIN outreach_recipients r ON r.id=d.recipient_id AND r.workspace_id=d.workspace_id WHERE d.id=$1 AND d.workspace_id=$2 AND d.channel_id=$3 AND d.state='DISPATCHING' AND d.lease_id=$4 AND d.lease_expires_at>now() FOR UPDATE OF d", [d.id, d.workspace_id, d.channel_id, d.lease_id])).rows[0];
        if (!row)
            throw new AppError(409, 'Outreach attempt is no longer current.');
        if (row.message_hash !== canonicalHash(row.frozen_message) || row.frozen_message !== d.frozen_message)
            throw new AppError(409, 'Frozen message identity changed.');
        const receipt = (await db.query<{
            status: string;
        }>('SELECT status FROM outreach_test_receipts WHERE delivery_id=$1 AND workspace_id=$2 AND channel_id=$3', [d.id, d.workspace_id, d.channel_id])).rows[0];
        if (receipt?.status === 'SENT')
            return { state: 'SENT', code: 'TEST_CONFIRMED_SENT' };
        const fixture = (await db.query<{
            test_outcome: string;
        }>('SELECT test_outcome FROM outreach_creators WHERE workspace_id=$1 AND channel_id=$2 AND creator_key=$3', [d.workspace_id, d.channel_id, d.creator_key])).rows[0];
        const mode = fixture?.test_outcome || 'FAILED';
        const retry = mode === 'RETRY_ALWAYS' || (['RETRY_ONCE', 'RATE_LIMIT'].includes(mode) && row.attempt_count === 1);
        const state: ProviderOutcome['state'] = retry ? 'RETRYABLE' : mode === 'RESTRICTED' ? 'RESTRICTED' : mode === 'FAILED' ? 'FAILED' : mode.startsWith('UNKNOWN') ? 'DELIVERY_UNKNOWN' : 'SENT';
        const providerStatus = state === 'SENT' || mode === 'UNKNOWN_SENT' ? 'SENT' : mode === 'UNKNOWN_PENDING' ? 'PENDING' : 'NOT_SENT';
        await db.query("INSERT INTO outreach_test_receipts(workspace_id,channel_id,delivery_id,status,simulated_sends) VALUES($1,$2,$3,$4,$5) ON CONFLICT(delivery_id) DO UPDATE SET status=excluded.status,call_count=outreach_test_receipts.call_count+1,simulated_sends=greatest(outreach_test_receipts.simulated_sends,excluded.simulated_sends),updated_at=now()", [d.workspace_id, d.channel_id, d.id, providerStatus, providerStatus === 'SENT' ? 1 : 0]);
        return { state, code: retry ? (mode === 'RATE_LIMIT' ? 'TEST_RATE_LIMIT' : 'TEST_PRE_SEND_TEMPORARY') : `TEST_${state}`, retryAfterMs: retry ? 1000 : undefined };
    });
}
export async function finishOutreach(d: ClaimedDelivery, outcome: ProviderOutcome, deferSettlement = false) {
    requireWorker();
    let settled = false;
    await transaction(async (db) => {
        const channel = await channelFor(db, d.workspace_id, d.channel_id, true);
        const c = await campaignFor(db, d.workspace_id, d.campaign_id, true), current = (await db.query<ClaimedDelivery>("SELECT * FROM outreach_deliveries WHERE workspace_id=$1 AND id=$2 AND state='DISPATCHING' AND lease_id=$3 AND lease_expires_at>now() FOR UPDATE", [d.workspace_id, d.id, d.lease_id])).rows[0];
        if (!current)
            throw new AppError(409, 'Outreach attempt is no longer current.');
        let state: DeliveryState = outcome.state;
        if (state === 'RETRYABLE' && (current.attempt_count >= 3 || c.cancel_requested_at))
            state = c.cancel_requested_at ? 'CANCELLED' : 'FAILED';
        const delay = state === 'RETRYABLE' ? (channel.provider === 'TEST' ? Math.max(1000, Math.min(outcome.retryAfterMs || 1000, 60000)) * 2 ** (current.attempt_count - 1) : Math.max(1000, outcome.retryAfterMs || 1000)) : 0;
        const code = /^[A-Z_]{1,64}$/.test(outcome.code) ? outcome.code : 'PROVIDER_OUTCOME_UNAVAILABLE';
        await db.query("UPDATE outreach_deliveries SET state=$1,lease_id=NULL,lease_expires_at=NULL,last_code=$2,available_at=now()+$3*interval '1 millisecond',finished_at=CASE WHEN $4 THEN now() ELSE NULL END,updated_at=now() WHERE id=$5", [state, code, delay, !['RETRYABLE', 'DELIVERY_UNKNOWN'].includes(state), d.id]);
        await db.query("UPDATE outreach_delivery_attempts SET state=$1,safe_code=$2,finished_at=now() WHERE delivery_id=$3 AND attempt_number=$4 AND lease_id=$5 AND state='STARTED'", [state === 'CANCELLED' ? 'FAILED' : state, code, d.id, current.attempt_count, d.lease_id]);
        await db.query("UPDATE outreach_outbox SET state=$1,available_at=now()+$2*interval '1 millisecond',updated_at=now() WHERE delivery_id=$3", [state === 'RETRYABLE' ? 'PENDING' : 'COMPLETED', delay, d.id]);
        if (state === 'RETRYABLE')
            await db.query("UPDATE outreach_channels SET next_send_at=greatest(next_send_at,now()+$1*interval '1 millisecond') WHERE id=$2", [delay, d.channel_id]);
        await contactOutcome(db, current, state);
        if (channel.provider !== 'TEST' && state !== 'RETRYABLE')
            await updateCanaryOutcome(current, state, db);
        await refreshCampaign(db, c);
        await audit(db, { workspaceId: d.workspace_id, billingAccountId: c.billing_account_id, type: `OUTREACH_DELIVERY_${state}`, targetType: 'outreach_campaign', targetId: c.id, metadata: { attempt: current.attempt_count, code } });
        settled = true;
    });
    if (settled && !deferSettlement)
        await settleCampaign(d.workspace_id, d.campaign_id);
    return settled;
}
export async function reconcileOutreach(session: Session, w: string, campaignId: string, deliveryId?: string) {
    await requireActiveWorkspace(session, w, 'outreach:manage');
    if (deliveryId && !/^[0-9a-f-]{36}$/.test(deliveryId))
        throw new AppError(404, 'Delivery not found.');
    const initial = await campaignFor({ query }, w, campaignId);
    const rows = (await query<{
        id: string;
    }>(`SELECT id FROM outreach_deliveries WHERE workspace_id=$1 AND campaign_id=$2${deliveryId ? ' AND id=$3' : ''}`, [w, campaignId, ...(deliveryId ? [deliveryId] : [])])).rows;
    if (deliveryId && !rows.length)
        throw new AppError(404, 'Delivery not found.');
    let resolved = 0;
    for (const r of rows)
        await transaction(async (db) => {
            await requireActiveWorkspace(session, w, 'outreach:manage', db);
            const channel = await channelFor(db, w, initial.channel_id, true);
            if (channel.provider === 'TEST')
                requireTest();
            const c = await campaignFor(db, w, campaignId, true), d = (await db.query<ClaimedDelivery>("SELECT * FROM outreach_deliveries WHERE workspace_id=$1 AND campaign_id=$2 AND id=$3 FOR UPDATE", [w, campaignId, r.id])).rows[0];
            if (d.state !== 'DELIVERY_UNKNOWN')
                return;
            if (channel.provider !== 'TEST') {
                const real = await realChannel(db, w, channel.id), proof = (await db.query<{
                    attempt_number: number;
                    provider_identity: string;
                    message_hash: string;
                    message_id: string;
                    request_id: string | null;
                    proof_hash: string;
                }>('SELECT * FROM outreach_provider_proofs WHERE delivery_id=$1 AND workspace_id=$2 AND channel_id=$3', [d.id, w, channel.id])).rows[0];
                const recipient = (await db.query<{
                    message_hash: string;
                }>('SELECT message_hash FROM outreach_recipients WHERE workspace_id=$1 AND id=$2', [w, d.recipient_id])).rows[0];
                if (!proof)
                    return;
                if (proof.attempt_number !== d.attempt_count || proof.provider_identity !== real.provider_identity || proof.message_hash !== recipient.message_hash || proof.proof_hash !== canonicalHash({ deliveryId: d.id, attempt: d.attempt_count, providerIdentity: real.provider_identity, messageHash: recipient.message_hash, messageId: proof.message_id, requestId: proof.request_id }))
                    throw new AppError(409, 'Provider evidence does not match immutable delivery attribution.');
                await db.query('INSERT INTO outreach_reconciliation_proofs(workspace_id,delivery_id,attempt_number,provider_status,proof_kind,proof_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [w, d.id, d.attempt_count, 'SENT', 'TIKTOK_ACCEPTED_MESSAGE_ID', proof.proof_hash, session.userId]);
                await db.query("UPDATE outreach_deliveries SET state='SENT',last_code='PROVIDER_CONFIRMED_SENT',finished_at=now(),updated_at=now() WHERE id=$1", [d.id]);
                await db.query("UPDATE outreach_outbox SET state='COMPLETED',updated_at=now() WHERE delivery_id=$1", [d.id]);
                await contactOutcome(db, d, 'SENT');
                await updateCanaryOutcome(d, 'SENT', db);
                await refreshCampaign(db, c);
                await audit(db, { workspaceId: w, billingAccountId: c.billing_account_id, actorUserId: session.userId, type: 'OUTREACH_DELIVERY_UNKNOWN_RESOLVED', targetType: 'outreach_campaign', targetId: c.id, metadata: { outcome: 'SENT', proofKind: 'TIKTOK_ACCEPTED_MESSAGE_ID', proofHash: proof.proof_hash } });
                resolved++;
                return;
            }
            const receipt = (await db.query<{
                status: 'SENT' | 'NOT_SENT' | 'PENDING';
                updated_at: Date;
            }>('SELECT status,updated_at FROM outreach_test_receipts WHERE workspace_id=$1 AND channel_id=$2 AND delivery_id=$3', [w, d.channel_id, d.id])).rows[0];
            if (receipt?.status === 'PENDING')
                return;
            const proofStatus = receipt?.status || 'NOT_SENT';
            const state: DeliveryState = proofStatus === 'SENT' ? 'SENT' : c.cancel_requested_at ? 'CANCELLED' : d.attempt_count >= 3 || channel.status !== 'CONNECTED' || !channel.outbound_capable ? 'FAILED' : 'RETRYABLE';
            await db.query('INSERT INTO outreach_reconciliation_proofs(workspace_id,delivery_id,attempt_number,provider_status,proof_kind,proof_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [w, d.id, d.attempt_count, proofStatus, 'ISOLATED_ATOMIC_TEST_PROVIDER', canonicalHash({ deliveryId: d.id, status: proofStatus, updatedAt: receipt?.updated_at || null }), session.userId]);
            await db.query("UPDATE outreach_deliveries SET state=$1,last_code=$2,available_at=now(),finished_at=CASE WHEN $3 THEN now() ELSE NULL END,updated_at=now() WHERE id=$4", [state, proofStatus === 'SENT' ? 'PROVIDER_CONFIRMED_SENT' : 'PROVIDER_CONFIRMED_NOT_SENT', state !== 'RETRYABLE', d.id]);
            await db.query("UPDATE outreach_outbox SET state=$1,available_at=now(),updated_at=now() WHERE delivery_id=$2", [state === 'RETRYABLE' ? 'PENDING' : 'COMPLETED', d.id]);
            await contactOutcome(db, d, state);
            await refreshCampaign(db, c);
            await audit(db, { workspaceId: w, billingAccountId: c.billing_account_id, actorUserId: session.userId, type: 'OUTREACH_DELIVERY_UNKNOWN_RESOLVED', targetType: 'outreach_campaign', targetId: c.id, metadata: { outcome: state, proofKind: 'ISOLATED_ATOMIC_TEST_PROVIDER', proofHash: canonicalHash({ deliveryId: d.id, status: proofStatus, updatedAt: receipt?.updated_at || null }) } });
            resolved++;
        });
    await settleCampaign(w, campaignId);
    return { resolved };
}
export async function outreachSettlementBatch() {
    const rows = (await query<{
        workspace_id: string;
        campaign_id: string;
    }>("SELECT b.workspace_id,b.campaign_id FROM outreach_campaign_billing b JOIN outreach_campaigns c ON c.id=b.campaign_id WHERE b.status='RESERVED' AND c.state IN('COMPLETED','COMPLETED_WITH_ERRORS','FAILED','CANCELLED') ORDER BY b.created_at LIMIT 50")).rows;
    let n = 0;
    for (const c of rows)
        if (await settleCampaign(c.workspace_id, c.campaign_id))
            n++;
    return n;
}
export async function executeOutreach(d: ClaimedDelivery) { const c = await channelFor({ query }, d.workspace_id, d.channel_id); return c.provider === 'TEST' ? fakeSend(d) : sendOwnedProvider(d); }
export async function outreachTick(workerId: string = randomUUID()) {
    requireWorker();
    await outreachHeartbeat(workerId);
    await recoverOutreachLeases();
    const d = await claimOutreach();
    if (d) {
        let outcome: ProviderOutcome;
        try {
            outcome = await executeOutreach(d);
        }
        catch (e) {
            if (e instanceof AppError && e.status === 409)
                return false;
            outcome = { state: 'DELIVERY_UNKNOWN', code: 'PROVIDER_RESPONSE_UNKNOWN' };
        }
        await finishOutreach(d, outcome);
    }
    await outreachSettlementBatch();
    return !!d;
}
