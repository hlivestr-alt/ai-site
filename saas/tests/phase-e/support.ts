import { expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { owner } from '../clipper-helpers';
import { fundFixture } from '../billing-helpers';
import { database, base, evidence } from '../stabilization/support';
export { database, base, evidence };
if (!process.env.STABILIZATION_RUN_ID || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL || !/^\/phase_e_\d+_[a-f0-9]+$/.test(new URL(process.env.DATABASE_URL!).pathname) || process.env.ENABLE_FAKE_OUTREACH_PROVIDER !== '1' || !process.env.OBJECT_STORAGE_BUCKET?.startsWith('phase-e-'))
    throw new Error('Owned Phase E fake-provider environment required');
export async function fixture(amount = '1000') { const email = `phase-e-${randomUUID()}@example.test`, a = await owner(email, false), db = await database(); fundFixture(a.workspaceId, amount); const r = await a.c.post(`/api/workspaces/${a.workspaceId}/outreach/channels`, { data: { provider: 'TEST', label: 'Controlled QA account' } }); expect(r.status()).toBe(201); const channel = (await r.json()).channel; return { ...a, email, db, channel, config: { channelId: channel.id, name: 'Controlled outreach acceptance', productName: 'QA product', messageTemplate: 'Hello {{creator_display_name}}, this is {{campaign_name}} for {{product_name}}.', targetCount: 4, cooldownDays: 30, rankingMetric: 'FOLLOWERS', rankingDirection: 'DESC', filters: {} } }; }
export async function quote(c: APIRequestContext, w: string, config: Record<string, unknown>) { const r = await c.post(`/api/workspaces/${w}/billing/quotes`, { data: { operation: 'OUTREACH', ...config } }); expect(r.status()).toBe(200); return (await r.json()).quote; }
export async function admit(f: Awaited<ReturnType<typeof fixture>>, patch: Record<string, unknown> = {}) { const config = { ...f.config, ...patch }, q = await quote(f.c, f.workspaceId, config), input = { ...config, idempotencyKey: randomUUID(), quoteId: q.id, quoteHash: q.quoteHash }, r = await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns`, { data: input }); expect(r.status()).toBe(201); return { id: (await r.json()).campaign.id as string, input, quote: q }; }
export function invoke(action: string, args: string[] = []) { return JSON.parse(execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'tests/phase-e/invoke.ts', action, ...args], { env: process.env, encoding: 'utf8', windowsHide: true })); }
export async function drain(f: Awaited<ReturnType<typeof fixture>>, id: string) { for (let n = 0; n < 120; n++) {
    invoke('tick');
    const c = (await f.db.query('SELECT state FROM outreach_campaigns WHERE id=$1', [id])).rows[0];
    if (['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED', 'DELIVERY_UNKNOWN'].includes(c.state))
        return c.state;
    await new Promise(r => setTimeout(r, 200));
} throw new Error('Controlled campaign did not reach a stable state'); }
export async function ledger(f: Awaited<ReturnType<typeof fixture>>, id: string) { return (await f.db.query('SELECT l.entry_type,count(*)::int count,sum(l.available_delta)::text available,sum(l.reserved_delta)::text reserved FROM token_ledger_entries l JOIN outreach_campaign_billing b ON b.quote_id=l.quote_id WHERE b.campaign_id=$1 GROUP BY l.entry_type ORDER BY l.entry_type', [id])).rows; }
export async function close(f: Awaited<ReturnType<typeof fixture>>) { try {
    const rows = (await f.db.query("SELECT id FROM outreach_campaigns WHERE workspace_id=$1 AND state NOT IN('COMPLETED','COMPLETED_WITH_ERRORS','FAILED','CANCELLED')", [f.workspaceId])).rows;
    for (const c of rows)
        await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/control`, { data: { action: 'cancel' } });
}
finally {
    await f.c.dispose();
    await f.db.end();
} }
export function launch(stage = '', label = 'worker') { const dir = resolve('test-data/phase-e', process.env.STABILIZATION_SUITE!, label); let output = ''; const child = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'scripts/outreach-worker.ts'], { cwd: process.cwd(), env: { ...process.env, PHASE_E_PROCESS_TEST: '1', PHASE_E_PAUSE_STAGE: stage, PHASE_E_FAULT_DIR: dir }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout!.on('data', b => output += b); child.stderr!.on('data', b => output += b); return { child, dir, output: () => output }; }
export function killOwned(child?: ChildProcess) { if (child?.pid && child.exitCode === null)
    try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'pipe' });
    }
    catch { } }
export async function marker(dir: string) { try {
    return JSON.parse(await readFile(resolve(dir, 'paused.json'), 'utf8'));
}
catch {
    return null;
} }
export async function logWorker(a: ReturnType<typeof launch>, label: string) { await writeFile(`${process.env.STABILIZATION_LOG_DIR}/${label}.log`, a.output()); }
