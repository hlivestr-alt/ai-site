import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Session } from './auth';
import { query, transaction, type DbClient } from './db';
import { AppError, audit, isUuid } from './core';
import { requireActiveWorkspace } from './products';
import { canonicalHash, billingRealm, lockWallet, integer } from './billing-core';
import { workspaceBillingAccount } from './billing-accounts';
import { can, type Permission } from './permissions';
import { validateCampaign, operationKey, selectRecipients, aggregateState, settlementAmounts, terminalCampaignStates, type CampaignConfig, type Creator, type Contact, type SelectedRecipient, type DeliveryState } from './outreach-core';
export type Channel = {
    id: string;
    workspace_id: string;
    provider: 'TEST' | 'TIKTOK_SHOP';
    label: string;
    status: string;
    outbound_capable: boolean;
    account_scope: string;
    send_interval_ms: number;
    next_send_at: Date;
    last_seen_at?: Date | null;
    created_at: Date;
    updated_at: Date;
};
export type Campaign = {
    id: string;
    workspace_id: string;
    billing_account_id: string;
    channel_id: string;
    name: string;
    operation_key: string;
    request_hash: string;
    config_snapshot: CampaignConfig;
    config_hash: string;
    recipient_hash: string;
    selected_count: number;
    state: string;
    created_by: string;
    created_at: Date;
    frozen_at: Date;
    started_at: Date | null;
    completed_at: Date | null;
    paused_at: Date | null;
    cancel_requested_at: Date | null;
};
export function testOutreachEnabled() { try {
    return ['test', 'local'].includes(process.env.APP_ENV || '') && process.env.ENABLE_FAKE_OUTREACH_PROVIDER === '1' && process.env.DATABASE_URL === process.env.TEST_DATABASE_URL && /^\/phase_e_\d+_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname);
}
catch {
    return false;
} }
function enabled() { if (process.env.OUTREACH_ENABLED === '0')
    throw new AppError(503, 'Outreach is currently unavailable.'); }
export function safeChannel(c: Channel) { return { id: c.id, label: c.label, provider: c.provider, status: c.status, outboundCapable: c.outbound_capable && (c.provider === 'TEST' && testOutreachEnabled()), createdAt: c.created_at, updatedAt: c.updated_at, realCertified: false, sendingAvailable: !!c.last_seen_at && Date.now() - c.last_seen_at.getTime() < 60000 }; }
export async function channelFor(db: DbClient, workspaceId: string, id: string, locked = false) { if (!isUuid(id))
    throw new AppError(404, 'Channel not found.'); const c = (await db.query<Channel>(`SELECT * FROM outreach_channels WHERE workspace_id=$1 AND id=$2${locked ? ' FOR UPDATE' : ''}`, [workspaceId, id])).rows[0]; if (!c)
    throw new AppError(404, 'Channel not found.'); return c; }
export function requireOutbound(c: Channel) { if (c.provider !== 'TEST' || !testOutreachEnabled() || c.status !== 'CONNECTED' || !c.outbound_capable)
    throw new AppError(409, 'Connect an authorized outbound channel before sending. Real connections are not certified yet.'); }
async function scoped(session: Session, workspaceId: string, permission: Permission, db?: DbClient) { enabled(); return requireActiveWorkspace(session, workspaceId, permission, db); }
export async function channelList(session: Session, workspaceId: string) { await scoped(session, workspaceId, 'outreach:view'); const rows = (await query<Channel>('SELECT c.*,h.last_seen_at FROM outreach_channels c LEFT JOIN outreach_channel_health h ON h.channel_id=c.id AND h.workspace_id=c.workspace_id WHERE c.workspace_id=$1 ORDER BY c.created_at DESC LIMIT 20', [workspaceId])).rows; return { channels: rows.map(safeChannel), testAvailable: testOutreachEnabled(), realCertified: false }; }
export async function channelDetail(session: Session, w: string, id: string) { await scoped(session, w, 'outreach:view'); return safeChannel(await channelFor({ query }, w, id)); }
export async function connectChannel(session: Session, w: string, raw: Record<string, unknown>) { await scoped(session, w, 'outreach:channel_manage'); if (Object.keys(raw).some(k => !['provider', 'label'].includes(k)) || !['TEST', 'TIKTOK_SHOP'].includes(String(raw.provider)) || typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 80 || /[\x00-\x1f\x7f]/.test(raw.label))
    throw new AppError(400, 'Use a channel type and a safe account label.'); const test = raw.provider === 'TEST'; if (test && !testOutreachEnabled())
    throw new AppError(404, 'Test channels are unavailable.'); return transaction(async (db) => { await scoped(session, w, 'outreach:channel_manage', db); await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [w]); if (Number((await db.query('SELECT count(*) n FROM outreach_channels WHERE workspace_id=$1', [w])).rows[0].n) >= 10)
    throw new AppError(409, 'This workspace already has ten channels.'); const c = (await db.query<Channel>("INSERT INTO outreach_channels(workspace_id,provider,label,status,outbound_capable,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *", [w, raw.provider, String(raw.label).trim(), test ? 'CONNECTED' : 'NOT_CONNECTED', test, session.userId])).rows[0]; if (test)
    for (let n = 1; n <= 12; n++)
        await db.query("INSERT INTO outreach_creators(workspace_id,channel_id,creator_key,display_name,username,category_ids,followers,gmv,gmv_currency,units_sold,video_views,live_viewers,engagement,ordinal) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'USD',$9,$10,$11,$12,$13)", [w, c.id, `qa_creator_${String(n).padStart(3, '0')}`, `QA Creator ${String(n).padStart(2, '0')}`, `qa_creator_${n}`, JSON.stringify([n % 2 ? 'beauty' : 'lifestyle']), 1000 * n, String(100 * n), 10 * n, 200 * n, 50 * n, n, n]); await audit(db, { workspaceId: w, actorUserId: session.userId, type: test ? 'OUTREACH_CHANNEL_CONNECTED' : 'OUTREACH_CHANNEL_REQUESTED', targetType: 'outreach_channel', targetId: c.id, metadata: { provider: c.provider, realCertified: false } }); return safeChannel(c); }); }
export async function disconnectChannel(session: Session, w: string, id: string) { await scoped(session, w, 'outreach:channel_manage'); return transaction(async (db) => { await scoped(session, w, 'outreach:channel_manage', db); const c = await channelFor(db, w, id, true); if (c.provider !== 'TEST')
    throw new AppError(409, 'This real connection is not active.'); await db.query("UPDATE outreach_channels SET status='DISCONNECTED',outbound_capable=false,updated_at=now() WHERE id=$1", [id]); await audit(db, { workspaceId: w, actorUserId: session.userId, type: 'OUTREACH_CHANNEL_DISCONNECTED', targetType: 'outreach_channel', targetId: id }); return { ...safeChannel(c), status: 'DISCONNECTED', outboundCapable: false }; }); }
export async function discover(db: DbClient, w: string, config: CampaignConfig) { const creators = (await db.query<Creator>("SELECT id,creator_key,display_name,username,category_ids,followers::float8,gmv::text,gmv_currency,units_sold::float8,video_views::float8,live_viewers::float8,engagement::float8,ordinal FROM outreach_creators WHERE workspace_id=$1 AND channel_id=$2 ORDER BY ordinal,id LIMIT 2001", [w, config.channelId])).rows; if (creators.length > 2000)
    throw new AppError(409, 'This discovery source exceeds the supported candidate limit.'); const contacts = new Map<string, Contact>(); const rows = (await db.query<{
    creator_key: string;
    do_not_contact: boolean;
    unknown_delivery_id: string | null;
    last_contacted_at: Date | null;
    reserved: boolean;
}>(`SELECT coalesce(c.creator_key,r.creator_key) creator_key,coalesce(c.do_not_contact,false) do_not_contact,c.unknown_delivery_id,c.last_contacted_at,(r.delivery_id IS NOT NULL) reserved FROM outreach_contact_state c FULL JOIN outreach_reservations r ON r.channel_id=c.channel_id AND r.creator_key=c.creator_key WHERE coalesce(c.workspace_id,r.workspace_id)=$1 AND coalesce(c.channel_id,r.channel_id)=$2`, [w, config.channelId])).rows; for (const r of rows)
    contacts.set(r.creator_key, r); return selectRecipients(config, creators, contacts); }
function snapshot(config: CampaignConfig, selected: SelectedRecipient[]) { return { kind: 'OUTREACH', policyVersion: 'outreach-confirmed-send-v1', config, selectedCount: selected.length, recipientKeys: selected.map(r => r.creatorKey), snapshotHash: canonicalHash(selected) }; }
export async function quoteOutreach(session: Session, w: string, raw: Record<string, unknown>) { await scoped(session, w, 'outreach:create'); const config = validateCampaign(raw); return transaction(async (db) => { await scoped(session, w, 'outreach:create', db); const channel = await channelFor(db, w, config.channelId); requireOutbound(channel); const discovery = await discover(db, w, config); if (!discovery.selected.length)
    throw new AppError(409, 'No eligible recipients match these settings.'); const price = (await db.query<{
    id: string;
    label: string;
    rules: Record<string, unknown>;
}>("SELECT v.id,v.label,v.rules FROM price_catalogs c JOIN price_versions v ON v.id=c.active_version_id AND v.catalog_id=c.id WHERE c.operation='OUTREACH' AND c.realm=$1", [billingRealm()])).rows[0]; if (!price || price.rules.approval !== 'INTERNAL_BETA' || price.rules.policyVersion !== 'outreach-confirmed-send-v1' || Number(price.rules.maxRecipients) < discovery.selected.length || Number(price.rules.maxRecipients) > 500)
    throw new AppError(503, 'Outreach pricing is unavailable.'); const perSend = integer(price.rules.perSuccessfulSend, true), amount = perSend * BigInt(discovery.selected.length); if (amount > 9007199254740991n)
    throw new AppError(503, 'Outreach pricing is invalid.'); const input = snapshot(config, discovery.selected), id = randomUUID(), account = await workspaceBillingAccount(w, db), expires = new Date(Date.now() + 15 * 60000), requestHash = canonicalHash(config), inputHash = canonicalHash(input), quoteHash = canonicalHash({ id, workspaceId: w, billingAccountId: account.billing_account_id, createdBy: session.userId, requestHash, inputHash, priceVersionId: price.id, tokenAmount: String(amount), expiresAt: expires.toISOString() }); await db.query("INSERT INTO billing_quotes(id,workspace_id,billing_account_id,created_by,operation,price_version_id,request_hash,input_hash,input_snapshot,token_amount,quote_hash,expires_at) VALUES($1,$2,$3,$4,'OUTREACH',$5,$6,$7,$8::jsonb,$9,$10,$11)", [id, w, account.billing_account_id, session.userId, price.id, requestHash, inputHash, JSON.stringify(input), String(amount), quoteHash, expires]); const wallet = (await db.query<{
    available_tokens: string;
    reserved_tokens: string;
}>('SELECT available_tokens,reserved_tokens FROM billing_account_wallets WHERE billing_account_id=$1', [account.billing_account_id])).rows[0]; return { id, quoteHash, billingAccountId: account.billing_account_id, operation: 'OUTREACH', priceVersionId: price.id, tokenAmount: String(amount), perSuccessfulSend: String(perSend), selectedCount: discovery.selected.length, summary: discovery.summary, recipients: discovery.selected.slice(0, 20).map(r => ({ displayName: r.displayName, username: r.username, followers: r.followers, categories: r.categories })), availableTokens: wallet.available_tokens, reservedTokens: wallet.reserved_tokens, affordable: BigInt(wallet.available_tokens) >= amount, expiresAt: expires.toISOString(), priceLabel: price.label, test: billingRealm() === 'TEST', internalBeta: true }; }); }
export async function recoverCampaign(session: Session, w: string, raw: Record<string, unknown>) {
    await scoped(session, w, 'outreach:view');
    const config = validateCampaign(raw), key = operationKey(raw.idempotencyKey);
    const c = (await query<Campaign>('SELECT * FROM outreach_campaigns WHERE workspace_id=$1 AND operation_key=$2', [w, key])).rows[0];
    if (!c)
        return null;
    if (c.request_hash !== canonicalHash(config))
        throw new AppError(409, 'This campaign request identity belongs to different settings.');
    return { id: c.id, state: c.state, existing: true };
}
export async function sendCampaign(session: Session, w: string, raw: Record<string, unknown>) { await scoped(session, w, 'outreach:send'); const config = validateCampaign(raw), key = operationKey(raw.idempotencyKey), requestHash = canonicalHash(config); return transaction(async (db) => { const wallet = await lockWallet(db, w); await scoped(session, w, 'outreach:send', db); const old = (await db.query<Campaign>('SELECT * FROM outreach_campaigns WHERE workspace_id=$1 AND operation_key=$2', [w, key])).rows[0]; if (old) {
    if (old.request_hash !== requestHash)
        throw new AppError(409, 'This campaign request identity belongs to different settings.');
    return { id: old.id, state: old.state, existing: true };
} const channel = await channelFor(db, w, config.channelId, true); requireOutbound(channel); if (Number((await db.query("SELECT count(*) n FROM outreach_campaigns WHERE workspace_id=$1 AND state NOT IN('COMPLETED','COMPLETED_WITH_ERRORS','CANCELLED','FAILED')", [w])).rows[0].n) >= 10)
    throw new AppError(409, 'Finish or cancel an active campaign before starting another.'); if (typeof raw.quoteId !== 'string' || !isUuid(raw.quoteId) || typeof raw.quoteHash !== 'string')
    throw new AppError(400, 'Get a Token quote before sending.'); const q = (await db.query<{
    id: string;
    created_by: string;
    operation: string;
    billing_account_id: string;
    request_hash: string;
    input_hash: string;
    input_snapshot: ReturnType<typeof snapshot>;
    quote_hash: string;
    token_amount: string;
    price_version_id: string;
    expires_at: Date;
}>('SELECT * FROM billing_quotes WHERE workspace_id=$1 AND id=$2 FOR SHARE', [w, raw.quoteId])).rows[0]; if (!q)
    throw new AppError(404, 'Quote not found.'); if (q.operation !== 'OUTREACH' || q.created_by !== session.userId || q.billing_account_id !== wallet.billing_account_id || q.request_hash !== requestHash || q.quote_hash !== raw.quoteHash || q.expires_at.getTime() <= Date.now())
    throw new AppError(409, 'Campaign quote changed or expired. Get a fresh quote.'); const selection = await discover(db, w, config), input = snapshot(config, selection.selected); if (!selection.selected.length || canonicalHash(input) !== q.input_hash)
    throw new AppError(409, 'Eligible recipients changed. Get a fresh quote before sending.'); if (BigInt(wallet.available_tokens) < BigInt(q.token_amount))
    throw new AppError(402, 'Insufficient Tokens. Add Tokens before sending.'); const price = (await db.query<{
    rules: Record<string, unknown>;
}>('SELECT rules FROM price_versions WHERE id=$1', [q.price_version_id])).rows[0], perSend = integer(price.rules.perSuccessfulSend, true); if (BigInt(q.token_amount) !== perSend * BigInt(selection.selected.length))
    throw new AppError(409, 'Campaign amount does not match the frozen selection.'); const id = randomUUID(), versionId = randomUUID(); await db.query("INSERT INTO outreach_campaigns(id,workspace_id,billing_account_id,channel_id,name,operation_key,request_hash,config_snapshot,config_hash,recipient_hash,selected_count,state,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$7,$9,$10,'QUEUED',$11)", [id, w, wallet.billing_account_id, channel.id, config.name, key, requestHash, JSON.stringify(config), q.input_hash, selection.selected.length, session.userId]); await db.query('INSERT INTO outreach_campaign_versions(id,workspace_id,campaign_id,config_snapshot,config_hash,created_by) VALUES($1,$2,$3,$4::jsonb,$5,$6)', [versionId, w, id, JSON.stringify(config), requestHash, session.userId]); for (const [index, r] of selection.selected.entries()) {
    const recipientId = randomUUID(), deliveryId = randomUUID();
    const { message, ...safeSnapshot } = r;
    await db.query('INSERT INTO outreach_recipients(id,workspace_id,campaign_id,channel_id,version_id,creator_key,safe_snapshot,frozen_message,message_hash,rank) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)', [recipientId, w, id, channel.id, versionId, r.creatorKey, JSON.stringify(safeSnapshot), message, canonicalHash(message), index + 1]);
    await db.query('INSERT INTO outreach_deliveries(id,workspace_id,campaign_id,channel_id,recipient_id,creator_key) VALUES($1,$2,$3,$4,$5,$6)', [deliveryId, w, id, channel.id, recipientId, r.creatorKey]);
    await db.query('INSERT INTO outreach_outbox(workspace_id,campaign_id,delivery_id) VALUES($1,$2,$3)', [w, id, deliveryId]);
    await db.query('INSERT INTO outreach_reservations(workspace_id,channel_id,creator_key,delivery_id) VALUES($1,$2,$3,$4)', [w, channel.id, r.creatorKey, deliveryId]);
} await db.query('INSERT INTO outreach_campaign_billing(campaign_id,workspace_id,billing_account_id,quote_id,price_version_id,token_amount,per_send) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, w, wallet.billing_account_id, q.id, q.price_version_id, q.token_amount, String(perSend)]); const reserveId = (await db.query<{
    id: string;
}>("INSERT INTO token_ledger_entries(workspace_id,billing_account_id,entry_type,available_delta,reserved_delta,quote_id,idempotency_key) VALUES($1,$2,'RESERVE',-$3::bigint,$3,$4,$5) RETURNING id", [w, wallet.billing_account_id, q.token_amount, q.id, `outreach:${id}:reserve`])).rows[0].id; await db.query('UPDATE outreach_campaign_billing SET reserve_ledger_id=$1 WHERE campaign_id=$2', [reserveId, id]); for (const type of ['OUTREACH_CAMPAIGN_CREATED', 'OUTREACH_DISCOVERY_COMPLETED', 'OUTREACH_CAMPAIGN_FROZEN', 'OUTREACH_CAMPAIGN_QUEUED', 'OUTREACH_TOKENS_RESERVED'])
    await audit(db, { workspaceId: w, billingAccountId: wallet.billing_account_id, actorUserId: session.userId, type, targetType: 'outreach_campaign', targetId: id, metadata: { selected: selection.selected.length, tokens: q.token_amount } }); return { id, state: 'QUEUED', existing: false }; }); }
export async function campaignFor(db: DbClient, w: string, id: string, locked = false) { if (!isUuid(id))
    throw new AppError(404, 'Campaign not found.'); const c = (await db.query<Campaign>(`SELECT * FROM outreach_campaigns WHERE workspace_id=$1 AND id=$2${locked ? ' FOR UPDATE' : ''}`, [w, id])).rows[0]; if (!c)
    throw new AppError(404, 'Campaign not found.'); return c; }
async function counts(db: DbClient, id: string) { const rows = (await db.query<{
    state: DeliveryState;
    count: number;
}>('SELECT state,count(*)::int count FROM outreach_deliveries WHERE campaign_id=$1 GROUP BY state', [id])).rows; const stateCounts = Object.fromEntries(rows.map(r => [r.state, r.count])); return { selected: rows.reduce((n, r) => n + r.count, 0), queued: (stateCounts.PENDING || 0) + (stateCounts.RETRYABLE || 0), sending: stateCounts.DISPATCHING || 0, sent: stateCounts.SENT || 0, restricted: stateCounts.RESTRICTED || 0, failed: stateCounts.FAILED || 0, unknown: stateCounts.DELIVERY_UNKNOWN || 0, cancelled: stateCounts.CANCELLED || 0, remaining: (stateCounts.PENDING || 0) + (stateCounts.RETRYABLE || 0) + (stateCounts.DISPATCHING || 0) + (stateCounts.DELIVERY_UNKNOWN || 0) }; }
export async function campaignList(session: Session, w: string) { await scoped(session, w, 'outreach:view'); const rows = (await query<Campaign>('SELECT * FROM outreach_campaigns WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100', [w])).rows; return Promise.all(rows.map(async (c) => ({ id: c.id, name: c.name, state: c.state, createdAt: c.created_at, startedAt: c.started_at, completedAt: c.completed_at, counts: await counts({ query }, c.id) }))); }
export async function campaignDetail(session: Session, w: string, id: string) { const membership = await scoped(session, w, 'outreach:view'), c = await campaignFor({ query }, w, id); const b = (await query<{
    token_amount: string;
    per_send: string;
    status: string;
    captured_tokens: string;
    released_tokens: string;
}>('SELECT token_amount,per_send,status,captured_tokens,released_tokens FROM outreach_campaign_billing WHERE workspace_id=$1 AND campaign_id=$2', [w, id])).rows[0]; return { id: c.id, name: c.name, state: c.state, createdAt: c.created_at, startedAt: c.started_at, completedAt: c.completed_at, paused: !!c.paused_at, cancelRequested: !!c.cancel_requested_at, counts: await counts({ query }, id), channel: safeChannel(await channelFor({ query }, w, c.channel_id)), config: c.config_snapshot, billing: { reservedMaximum: b.token_amount, perSuccessfulSend: b.per_send, status: b.status, capturedTokens: b.captured_tokens, releasedTokens: b.released_tokens, internalBeta: true }, canManage: can(membership.role, 'outreach:manage') }; }
export async function recipientList(session: Session, w: string, id: string) { await scoped(session, w, 'outreach:view'); await campaignFor({ query }, w, id); return (await query("SELECT r.id,r.safe_snapshot->>'displayName' display_name,r.safe_snapshot->>'username' username,r.safe_snapshot->'followers' followers,r.safe_snapshot->'categories' categories,r.rank,d.id delivery_id,d.state FROM outreach_recipients r JOIN outreach_deliveries d ON d.recipient_id=r.id AND d.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND r.campaign_id=$2 ORDER BY r.rank LIMIT 500", [w, id])).rows; }
export async function recipientMessage(session: Session, w: string, campaignId: string, id: string) { await scoped(session, w, 'outreach:view'); await campaignFor({ query }, w, campaignId); if (!isUuid(id))
    throw new AppError(404, 'Recipient not found.'); const r = (await query<{
    id: string;
    frozen_message: string;
    message_hash: string;
}>('SELECT id,frozen_message,message_hash FROM outreach_recipients WHERE workspace_id=$1 AND campaign_id=$2 AND id=$3', [w, campaignId, id])).rows[0]; if (!r)
    throw new AppError(404, 'Recipient not found.'); return { id: r.id, message: r.frozen_message }; }
export async function deliveryDetail(session: Session, w: string, campaignId: string, id: string) { await scoped(session, w, 'outreach:view'); await campaignFor({ query }, w, campaignId); if (!isUuid(id))
    throw new AppError(404, 'Delivery not found.'); const d = (await query('SELECT id,state,attempt_count,started_at,finished_at FROM outreach_deliveries WHERE workspace_id=$1 AND campaign_id=$2 AND id=$3', [w, campaignId, id])).rows[0]; if (!d)
    throw new AppError(404, 'Delivery not found.'); return { ...d, attempts: (await query('SELECT id,attempt_number,state,safe_code,started_at,finished_at FROM outreach_delivery_attempts WHERE workspace_id=$1 AND delivery_id=$2 ORDER BY attempt_number', [w, id])).rows }; }
export async function campaignAudit(session: Session, w: string, id: string) { await scoped(session, w, 'outreach:view'); await campaignFor({ query }, w, id); return (await query("SELECT id,event_type,created_at,safe_metadata FROM audit_events WHERE workspace_id=$1 AND target_type='outreach_campaign' AND target_id=$2 ORDER BY created_at,id LIMIT 100", [w, id])).rows; }
export async function refreshCampaign(db: DbClient, c: Campaign) { const states = (await db.query<{
    state: DeliveryState;
}>('SELECT state FROM outreach_deliveries WHERE workspace_id=$1 AND campaign_id=$2 ORDER BY id', [c.workspace_id, c.id])).rows.map(r => r.state), state = aggregateState(states, !!c.paused_at, !!c.cancel_requested_at); await db.query(`UPDATE outreach_campaigns SET state=$1,completed_at=CASE WHEN $2 THEN coalesce(completed_at,now()) ELSE completed_at END,updated_at=now() WHERE id=$3`, [state, terminalCampaignStates.includes(state), c.id]); return { state, states }; }
export async function settleCampaign(w: string, id: string) { return transaction(async (db) => { await lockWallet(db, w); const initial = await campaignFor(db, w, id); await channelFor(db, w, initial.channel_id, true); const c = await campaignFor(db, w, id, true), b = (await db.query<{
    status: string;
    token_amount: string;
    per_send: string;
    quote_id: string;
    billing_account_id: string;
}>('SELECT * FROM outreach_campaign_billing WHERE workspace_id=$1 AND campaign_id=$2 FOR UPDATE', [w, id])).rows[0]; if (b.status !== 'RESERVED')
    return false; const refreshed = await refreshCampaign(db, c), amounts = settlementAmounts(BigInt(b.token_amount), BigInt(b.per_send), refreshed.states); if (!amounts)
    return false; let captureId = null, releaseId = null; for (const [type, amount] of [['CAPTURE', amounts.captured], ['RELEASE', amounts.released]] as const) {
    if (!amount)
        continue;
    const ledger = (await db.query<{
        id: string;
    }>("INSERT INTO token_ledger_entries(workspace_id,billing_account_id,entry_type,available_delta,reserved_delta,quote_id,idempotency_key) VALUES($1,$2,$3,$4,-$5::bigint,$6,$7) RETURNING id", [w, b.billing_account_id, type, type === 'RELEASE' ? String(amount) : '0', String(amount), b.quote_id, `outreach:${id}:${type.toLowerCase()}`])).rows[0].id;
    if (type === 'CAPTURE')
        captureId = ledger;
    else
        releaseId = ledger;
    await audit(db, { workspaceId: w, billingAccountId: b.billing_account_id, type: `OUTREACH_TOKENS_${type === 'CAPTURE' ? 'CAPTURED' : 'RELEASED'}`, targetType: 'outreach_campaign', targetId: id, metadata: { tokens: String(amount) } });
} await db.query("UPDATE outreach_campaign_billing SET status='SETTLED',captured_tokens=$1,released_tokens=$2,capture_ledger_id=$3,release_ledger_id=$4,settled_at=now() WHERE campaign_id=$5", [String(amounts.captured), String(amounts.released), captureId, releaseId, id]); await audit(db, { workspaceId: w, billingAccountId: b.billing_account_id, type: `OUTREACH_CAMPAIGN_${refreshed.state}`, targetType: 'outreach_campaign', targetId: id, metadata: { sent: refreshed.states.filter(s => s === 'SENT').length } }); return true; }); }
export async function controlCampaign(session: Session, w: string, id: string, action: string) { await scoped(session, w, 'outreach:manage'); if (!['pause', 'resume', 'cancel'].includes(action))
    throw new AppError(400, 'Unsupported campaign action.'); await transaction(async (db) => { await lockWallet(db, w); await scoped(session, w, 'outreach:manage', db); const initial = await campaignFor(db, w, id); const channel = await channelFor(db, w, initial.channel_id, true), c = await campaignFor(db, w, id, true); if (action === 'cancel' && c.cancel_requested_at)
    return; if (terminalCampaignStates.includes(c.state))
    throw new AppError(409, 'This campaign is already complete.'); if (action === 'resume') {
    if (!c.paused_at)
        throw new AppError(409, 'This campaign is not paused.');
    if (c.cancel_requested_at)
        throw new AppError(409, 'Cancelled messages cannot resume.');
    requireOutbound(channel);
    await db.query('UPDATE outreach_campaigns SET paused_at=NULL,updated_at=now() WHERE id=$1', [id]);
    c.paused_at = null;
}
else if (action === 'pause') {
    if (c.paused_at)
        return;
    await db.query('UPDATE outreach_campaigns SET paused_at=now(),updated_at=now() WHERE id=$1', [id]);
    c.paused_at = new Date();
}
else {
    await db.query('UPDATE outreach_campaigns SET cancel_requested_at=now(),updated_at=now() WHERE id=$1', [id]);
    c.cancel_requested_at = new Date();
    await db.query("UPDATE outreach_deliveries SET state='CANCELLED',last_code='CANCELLED_BEFORE_SEND',finished_at=now(),updated_at=now() WHERE workspace_id=$1 AND campaign_id=$2 AND state IN('PENDING','RETRYABLE')", [w, id]);
    await db.query("UPDATE outreach_outbox SET state='COMPLETED',updated_at=now() WHERE campaign_id=$1 AND delivery_id IN(SELECT id FROM outreach_deliveries WHERE campaign_id=$1 AND state='CANCELLED')", [id]);
    await db.query("DELETE FROM outreach_reservations WHERE delivery_id IN(SELECT id FROM outreach_deliveries WHERE campaign_id=$1 AND state='CANCELLED')", [id]);
} await refreshCampaign(db, c); await audit(db, { workspaceId: w, billingAccountId: c.billing_account_id, actorUserId: session.userId, type: ({ pause: 'OUTREACH_CAMPAIGN_PAUSED', resume: 'OUTREACH_CAMPAIGN_RESUMED', cancel: 'OUTREACH_CAMPAIGN_CANCELLED' } as Record<string, string>)[action], targetType: 'outreach_campaign', targetId: id }); }); await settleCampaign(w, id); return campaignDetail(session, w, id); }
