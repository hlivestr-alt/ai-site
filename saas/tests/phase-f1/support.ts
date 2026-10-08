import { expect, request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { owner } from '../clipper-helpers';
import { fundFixture } from '../billing-helpers';
import { database, base, evidence } from '../stabilization/support';
import { quote, drain, ledger, close } from '../phase-e/support';
export { database, base, evidence, quote, drain, ledger, close };
export async function fixture(amount = '1000', fixedLabel = '') {
    const email = `phase-f1-${fixedLabel || randomUUID()}-${process.env.STABILIZATION_RUN_ID}@example.test`, a = await owner(email, false), db = await database();
    fundFixture(a.workspaceId, amount);
    const r = await a.c.post(`/api/workspaces/${a.workspaceId}/outreach/channels`, { data: { provider: 'TEST', label: 'Synthetic QA account' } });
    expect(r.status()).toBe(201);
    const channel = (await r.json()).channel;
    return { ...a, email, db, channel, config: { channelId: channel.id, name: 'Controlled provider certification', productName: '', messageTemplate: 'Controlled QA certification. Please confirm receipt.', targetCount: 1, cooldownDays: 30, rankingMetric: 'FOLLOWERS', rankingDirection: 'DESC', filters: {} } };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;
export function invoke(action: string, f?: Fixture, id = '', arg = '', patch: Record<string, string> = {}) { return JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'tests/phase-f1/invoke.ts', action, f?.email || '', f?.workspaceId || '', id, arg], { env: { ...process.env, ...(f ? { PLATFORM_OPERATOR_EMAILS: f.email } : {}), ...patch }, encoding: 'utf8', windowsHide: true })); }
export async function ownedReal(f: Fixture, scenario = 'VALID', identity?: string) {
    const r = await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/channels`, { data: { provider: 'TIKTOK_SHOP', label: 'Controlled owned shop' } });
    expect(r.status()).toBe(201);
    const c = (await r.json()).channel;
    await f.db.query('INSERT INTO outreach_provider_fixtures(workspace_id,channel_id,external_identity,scenario) VALUES($1,$2,$3,$4)', [f.workspaceId, c.id, identity || `controlled_shop_${c.id}`, scenario]);
    const connected = invoke('connect', f, c.id);
    expect(connected.status === undefined).toBe(true);
    return c;
}
export async function ready(f: Fixture, c: {
    id: string;
}, approve = true) {
    expect(invoke('recipient', f, c.id)).toMatchObject({ registered: true });
    const ticket = invoke('prepare', f, '', JSON.stringify({ ...f.config, channelId: c.id }));
    expect(ticket.status).toBe('WAITING_FOR_OPERATOR_APPROVAL');
    if (approve)
        expect(invoke('approve', f, ticket.id)).toMatchObject({ approved: true });
    return ticket;
}
export async function admitReal(f: Fixture, ticket: {
    config: Record<string, unknown>;
}) { const q = await quote(f.c, f.workspaceId, ticket.config), r = await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns`, { data: { ...ticket.config, idempotencyKey: randomUUID(), quoteId: q.id, quoteHash: q.quoteHash } }); expect(r.status()).toBe(201); return { id: (await r.json()).campaign.id as string, input: ticket.config }; }
export async function stats(f: Fixture, id: string) { return (await f.db.query('SELECT api_calls,message_calls,refresh_calls FROM outreach_provider_fixtures WHERE channel_id=$1', [id])).rows[0]; }
export async function channel(f: Fixture, id: string) { const previous = f.c; f.c = await request.newContext({ baseURL: base, storageState: await previous.storageState(), extraHTTPHeaders: { Origin: base } }); await previous.dispose(); const r = await f.c.get(`/api/workspaces/${f.workspaceId}/outreach/channels/${id}`); expect(r.status()).toBe(200); return (await r.json()).channel; }
