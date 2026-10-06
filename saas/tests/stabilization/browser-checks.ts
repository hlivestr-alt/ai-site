import {expect,request,type Page} from '@playwright/test';
import {configuredSecrets,scanText} from './secret-audit.mjs';
const base=process.env.SAAS_TEST_BASE_URL!;
const password='ValidPassword123!'; // isolated public fixture
export async function login(email: string, target = base, pass = password) {
  const c = await request.newContext({ baseURL: target, extraHTTPHeaders: { Origin: target } });
  const response = await c.post('/api/auth/login', { data: { email, password: pass } });
  expect(response.status(), 'Fixture login status').toBe(200); return c;
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
