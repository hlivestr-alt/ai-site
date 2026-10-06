import { expect, request, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { owner, dispatch } from '../clipper-helpers';
import { product, videoJob, settle, fixtureClips, publishJob, posters } from '../content-helpers';
import { definition, configuration } from '../workflow-helpers';
import { configuredSecrets, scanText } from './secret-audit.mjs';

export const base = process.env.SAAS_TEST_BASE_URL!;
export const password = 'ValidPassword123!'; // public, isolated fixture password, never a customer credential
export const evidenceDir = 'docs/master-acceptance-evidence';
export async function evidence(name: string, data: unknown) {
  await mkdir(evidenceDir, { recursive: true }); await mkdir('test-data/master-acceptance', { recursive: true });
  const json = JSON.stringify({ runId: process.env.MASTER_QA_RUN_ID, ...data as Record<string, unknown> }, null, 2);
  await writeFile(`${evidenceDir}/${name}.json`, json); await writeFile(`test-data/master-acceptance/${name}.json`, json);
}
export async function database() { const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL }); await db.connect(); return db; }
export async function login(email: string, target = base, pass = password) {
  const c = await request.newContext({ baseURL: target, extraHTTPHeaders: { Origin: target } });
  const response = await c.post('/api/auth/login', { data: { email, password: pass } });
  expect(response.status(), 'Fixture login status').toBe(200); return c;
}
export async function fixtures() {
  const file = 'test-data/master-acceptance/fixtures.json';
  try { const f = JSON.parse(await readFile(file, 'utf8')); if (f.runId === process.env.MASTER_QA_RUN_ID) return f; } catch {}
  const email = `master-local-${process.env.MASTER_QA_RUN_ID}@example.test`;
  const a = await owner(email), b = await owner(`master-other-${process.env.MASTER_QA_RUN_ID}@example.test`, false), db = await database();
  try {
    const p = await product(a.c, a.workspaceId), aiId = await videoJob(a.c, a.workspaceId, p.id);
    expect(await settle(db, aiId)).toBe('SUCCEEDED');
    const aiContentId = (publishJob(a.workspaceId, aiId) as string[][])[0][0];
    const clips = await fixtureClips(a.c, a.workspaceId, db);
    const clipContentIds = (publishJob(a.workspaceId, clips.jobId) as string[][])[0];
    dispatch(); // Reconcile the completed fixture's reservation BEFORE boundary snapshots.
    posters();
    const workflow = await definition(a.c, a.workspaceId, configuration(p.id));
    const catalog = await (await a.c.get(`/api/workspaces/${a.workspaceId}/billing/packages`)).json();
    const payment = await a.c.post(`/api/workspaces/${a.workspaceId}/billing/payments`, { data: { packageVersionId: catalog.packages[0].id, idempotencyKey: crypto.randomUUID() } });
    expect(payment.status()).toBe(201); const paymentId = (await payment.json()).payment.id;
    expect((await a.c.post(`/api/workspaces/${a.workspaceId}/billing/payments/${paymentId}/simulate`, { data: { status: 'PAID' } })).status()).toBe(200);
    const f = { runId: process.env.MASTER_QA_RUN_ID, email, otherEmail: `master-other-${process.env.MASTER_QA_RUN_ID}@example.test`,
      workspaceId: a.workspaceId, otherWorkspaceId: b.workspaceId, productId: p.id, assetId: p.reference.assetId, assetVersionId: p.reference.versionId,
      aiJobId: aiId, clipJobId: clips.jobId, sourceId: clips.source.id, aiContentId, clipContentIds, workflowId: workflow.id, paymentId };
    await writeFile(file, JSON.stringify(f, null, 2)); return f;
  } finally { await a.c.dispose(); await b.c.dispose(); await db.end(); }
}
export async function snapshot(c: APIRequestContext, f: Awaited<ReturnType<typeof fixtures>>) {
  const out: Record<string, unknown> = {};
  for (const [key, path] of Object.entries({ session: '/api/auth/session', products: `/api/workspaces/${f.workspaceId}/products`,
    product: `/api/workspaces/${f.workspaceId}/products/${f.productId}`, wallet: `/api/workspaces/${f.workspaceId}/billing`,
    sources: `/api/workspaces/${f.workspaceId}/sources`, video: `/api/workspaces/${f.workspaceId}/ai-videos/${f.aiJobId}`,
    clips: `/api/workspaces/${f.workspaceId}/clipper/${f.clipJobId}`, content: `/api/workspaces/${f.workspaceId}/content`,
    memberships: `/api/workspaces/${f.workspaceId}/members`, workflows: `/api/workspaces/${f.workspaceId}/workflows`, workflow: `/api/workspaces/${f.workspaceId}/workflows/${f.workflowId}`,
    payments: `/api/workspaces/${f.workspaceId}/billing/payments`, tokenLedger: `/api/workspaces/${f.workspaceId}/billing/ledger` })) {
    const r = await c.get(path); expect(r.status(), `Snapshot ${key} status`).toBe(200); out[key] = await r.json();
  }
  return out;
}
export function pathOnly(url: string) { try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return '[invalid URL]'; } }
export async function observe(page: Page, target = base) {
  const secrets = await configuredSecrets(), network: { path: string; status: number }[] = [], requests: { path: string; time: number; method: string }[] = [];
  const consoleErrors: string[] = [], crashes: string[] = [], failed: { path: string; category: string }[] = [], leaks: { source: string; category: string; valueDetected: boolean }[] = [];
  const responseReads: Promise<void>[] = [], scannedResponses: Record<string, number> = {}, webSocketErrors: { path: string; category: string }[] = [];
  page.on('console', msg => { const categories = scanText(msg.text(), secrets); for (const category of categories) leaks.push({ source: 'browser-console', category, valueDetected: true });
    if (msg.type() === 'error') consoleErrors.push(categories.length ? '[credential redacted]' : msg.text().replace(/https?:\/\/\S+/g, '[URL]')); });
  page.on('websocket', socket => socket.on('socketerror', () => webSocketErrors.push({ path: pathOnly(socket.url()), category: 'WEBSOCKET_ERROR' })));
  page.on('pageerror', error => crashes.push(scanText(error.message, secrets).length ? '[credential redacted]' : error.message));
  page.on('request', r => { if (r.url().startsWith(target)) requests.push({ path: new URL(r.url()).pathname, time: Date.now(), method: r.method() }); });
  page.on('requestfailed', r => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) failed.push({ path: pathOnly(r.url()), category: r.failure()?.errorText || 'UNKNOWN' }); });
  page.on('response', r => {
    if (r.url().startsWith(target) && r.status() >= 400) network.push({ path: new URL(r.url()).pathname, status: r.status() });
    if (!r.url().startsWith(target)) return;
    const contentType = r.headers()['content-type'] || '';
    if (!/json|html|javascript|text\//.test(contentType)) return;
    responseReads.push((async () => { try { const text = await Promise.race([r.text(), new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Response audit timeout')), 5000))]);
      scannedResponses[contentType] = (scannedResponses[contentType] || 0) + 1;
      for (const category of scanText(text, secrets)) leaks.push({ source: new URL(r.url()).pathname, category, valueDetected: true }); } catch {} })());
  });
  return { consoleErrors, crashes, failed, network, requests, leaks, scannedResponses, webSocketErrors, finish: async () => { await Promise.allSettled(responseReads); } };
}
export async function browserContext(browser: Browser, f: Awaited<ReturnType<typeof fixtures>>, viewport?: { width: number; height: number }) {
  const c = await login(f.email); const state = await c.storageState(); await c.dispose();
  return browser.newContext({ baseURL: base, storageState: state, viewport: viewport || { width: 1440, height: 1000 } });
}
export async function layout(page: Page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const visible = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
    const clipped = Array.from(document.querySelectorAll('button,input,select,textarea,a.button,[role="dialog"]')).filter(visible).map(el => {
      const r = el.getBoundingClientRect(); return { kind: el.tagName, label: (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).type || '').trim().slice(0, 80), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
    }).filter(r => r.left < -2 || r.right > width + 2);
    return { viewportWidth: width, documentWidth: document.documentElement.scrollWidth, clipped, navigationLinks: Array.from(document.querySelectorAll('nav a')).filter(visible).length };
  });
}
export async function mediaChecks(page: Page) {
  const checks = [];
  await expect(page.locator('video').first()).toBeVisible({ timeout: 20_000 });
  for (const video of await page.locator('video').all()) {
    await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
    const state = await video.evaluate(v => ({ readyState: (v as HTMLVideoElement).readyState, error: (v as HTMLVideoElement).error?.code || null, duration: (v as HTMLVideoElement).duration }));
    expect(state.error, 'Playback media error').toBeNull(); checks.push(state);
  }
  return checks;
}
export function digest(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
