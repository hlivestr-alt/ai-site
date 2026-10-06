import { test, expect, chromium, request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { evidence, evidenceDir, observe, layout } from './support';

test('22/23/24/26/27/28 real remote controlled account, logout, new session and both browser channels', async ({ browser }) => {
  test.setTimeout(300_000);
  const base = process.env.MASTER_QA_REMOTE_BASE!, email = process.env.MASTER_QA_REMOTE_EMAIL, pass = process.env.MASTER_QA_REMOTE_PASSWORD;
  if (!email || !pass) { await evidence('remote', { status: 'BLOCKED', reason: 'Controlled remote QA credentials are unavailable.' }); test.skip(true, 'Remote controlled identity unavailable.'); return; }
  const values = parseEnv(await readFile('.env.local', 'utf8'));
  const db = new pg.Client({ connectionString: values.DATABASE_URL }); await db.connect();
  const normalRuns: Record<string, unknown>[] = [], responsive: Record<string, unknown>[] = [], defects: string[] = [];
  const a = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
  let workspaceId = '';
  async function hydratedForm(page: import('@playwright/test').Page) {
    await page.waitForFunction(() => Array.from(document.querySelectorAll('form')).some(form => {
      const key = Object.keys(form).find(k => k.startsWith('__reactProps$'));
      return key && typeof (form as unknown as Record<string, { onSubmit?: unknown }>)[key]?.onSubmit === 'function';
    }), { timeout: 25_000 });
  }
  async function formLogin(page: import('@playwright/test').Page) {
    await page.goto('/login', { waitUntil: 'domcontentloaded' }); await hydratedForm(page);
    await page.getByLabel('Email address').fill(email!); await page.getByLabel('Password').fill(pass!);
    const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST'), page.getByRole('button', { name: /Sign in/ }).click()]);
    await evidence('remote-form-login', { status: response.status() === 200 ? 'PASS' : 'FAIL', httpStatus: response.status(), hydrationObserved: true });
    expect(response.status(), 'Remote browser form login HTTP status').toBe(200);
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { waitUntil: 'domcontentloaded' });
  }
  try {
    const login = await a.post('/api/auth/login', { data: { email, password: pass } }); expect(login.status(), 'Controlled remote login').toBe(200);
    const create = await a.post('/api/workspaces', { data: { name: `Master QA ${process.env.MASTER_QA_RUN_ID}` } }); expect(create.status()).toBe(201);
    workspaceId = (await create.json()).workspace.id;
    await evidence('remote', { status: 'RUNNING', workspaceId, ownedRemoteAccount: true, paidRequests: 0 });
    for (const channel of ['chrome', 'msedge'] as const) {
      let edge;
      try { if (channel === 'msedge') edge = await chromium.launch({ channel: 'msedge', headless: true }); }
      catch { normalRuns.push({ channel, status: 'BLOCKED', reason: 'channel=msedge could not launch; Chromium not substituted.' }); continue; }
      const context = await (edge || browser).newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(), observed = await observe(page, base);
      try {
        await formLogin(page);
        if (new URL(page.url()).pathname === '/onboarding') { defects.push('Remote login did not resolve owned workspace'); continue; }
        const pages = [];
        for (const path of ['/', '/products', '/ai-videos', '/clipper', '/content', '/settings', '/billing']) {
          await page.goto(path, { waitUntil: 'domcontentloaded' }); await expect(page.locator('h1')).toBeVisible();
          const text = await page.locator('body').innerText(); const ok = !/Application error|client-side exception|Internal Server Error/.test(text);
          pages.push({ path, status: ok ? 'PASS' : 'FAIL' }); if (!ok) defects.push(`${channel} ${path}: page error`);
        }
        await page.waitForTimeout(3000); await observed.finish();
        const normal = { channel, browserVersion: (edge || browser).version(), pages, consoleErrors: [...observed.consoleErrors], crashes: [...observed.crashes],
          failedRequests: [...observed.failed], failedSameOriginResponses: [...observed.network], webSocketErrors: [...observed.webSocketErrors], scannedResponses: { ...observed.scannedResponses }, secretFindings: [...observed.leaks] };
        normalRuns.push(normal);
        if (observed.crashes.length) defects.push(`${channel}: uncaught remote browser exception`);
        if (observed.leaks.length) defects.push(`${channel}: configured secret value in remote browser response`);
        if (channel === 'chrome') {
          await page.setViewportSize({ width: 390, height: 844 });
          for (const path of ['/', '/products', '/products/new', '/ai-videos', '/clipper', '/content', '/settings', '/billing']) {
            await page.goto(path, { waitUntil: 'domcontentloaded' }); await expect(page.locator('h1')).toBeVisible(); await page.waitForTimeout(300);
            const metrics = await layout(page), row: Record<string, unknown> = { path, viewport: '390x844', ...metrics };
            if (metrics.documentWidth > 392 || metrics.clipped.length || metrics.navigationLinks < 6) {
              const screenshot = `${evidenceDir}/responsive-remote-390-${path.replace(/[^a-zA-Z0-9]/g, '-') || 'home'}.png`;
              await page.screenshot({ path: screenshot, fullPage: true }); row.screenshot = screenshot; defects.push(`remote ${path}: responsive overflow`);
            }
            responsive.push(row);
          }
          await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto('/products', { waitUntil: 'domcontentloaded' });
          const cookie = (await context.cookies()).find(c => c.name === 'saas_session')!;
          const stores = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, documentCookie: document.cookie }));
          const exposed = (await page.content()).includes(cookie.value) || stores.includes(cookie.value);
          const old = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base, Cookie: `saas_session=${cookie.value}` } });
          const beforeSession = await (await context.request.get('/api/auth/session')).json();
          const beforeProducts = await (await context.request.get(`/api/workspaces/${workspaceId}/products`)).json();
          await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => {
            if (button.textContent !== 'Sign out') return false; const key = Object.keys(button).find(k => k.startsWith('__reactProps$'));
            return key && typeof (button as unknown as Record<string, { onClick?: unknown }>)[key]?.onClick === 'function';
          }), { timeout: 25_000 });
          await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.waitForURL('**/login', { waitUntil: 'domcontentloaded' });
          const revokedStatus = (await old.get('/api/auth/session')).status(), privateStatus = (await old.get(`/api/workspaces/${workspaceId}/products`)).status();
          await page.goBack(); const backAPI = (await context.request.get(`/api/workspaces/${workspaceId}/products`)).status();
          const backText = await page.locator('body').innerText(); const backPrivateVisible = backText.includes('Master QA Remote') && !page.url().endsWith('/login');
          await page.reload(); const reloadAuth = page.url().endsWith('/login'); await page.goto('/settings'); const directAuth = page.url().endsWith('/login');
          const revokedInDB = (await db.query('SELECT revoked_at IS NOT NULL revoked FROM sessions WHERE user_id=$1 AND token_hash=$2', [process.env.MASTER_QA_REMOTE_USER_ID, createHash('sha256').update(cookie.value).digest('hex')])).rows[0]?.revoked;
          await old.dispose();
          const fresh = await browser.newContext({ baseURL: base }), freshPage = await fresh.newPage();
          try {
            await formLogin(freshPage); await freshPage.reload();
            const afterSession = await (await fresh.request.get('/api/auth/session')).json();
            const afterProducts = await (await fresh.request.get(`/api/workspaces/${workspaceId}/products`)).json();
            const persisted = JSON.stringify(beforeSession) === JSON.stringify(afterSession) && JSON.stringify(beforeProducts) === JSON.stringify(afterProducts);
            await evidence('test28-remote', { status: persisted ? 'PASS' : 'FAIL', freshBrowserContext: true, formLogin: true, reloaded: true,
              accountMembershipAndEmptyWorkspaceDataPreserved: persisted, artifactHistoryCoverage: 'Covered by isolated complete fixtures; no remote paid content created.', outreach: 'NOT IMPLEMENTED / separate future phase' });
            const expired = (await fresh.cookies()).find(c => c.name === 'saas_session')!;
            await db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1 AND token_hash=$2", [process.env.MASTER_QA_REMOTE_USER_ID, createHash('sha256').update(expired.value).digest('hex')]);
            const expiredStatus = (await fresh.request.get('/api/auth/session')).status();
            await evidence('test22-remote', { status: revokedStatus === 401 && privateStatus === 401 && backAPI === 401 && reloadAuth && directAuth && revokedInDB && expiredStatus === 401 && !exposed ? 'PASS' : 'FAIL',
              revokedStatus, privateStatus, backAPI, backPrivateVisible, reloadRequiresAuthentication: reloadAuth, directRouteRequiresAuthentication: directAuth,
              serverSideRevocation: revokedInDB, expiredStatus, httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite, credentialExposedInHTMLOrStorage: exposed });
            if (revokedStatus !== 401 || privateStatus !== 401 || backAPI !== 401 || !reloadAuth || !directAuth || !revokedInDB || expiredStatus !== 401 || exposed) defects.push('Remote logout/session acceptance failure');
            if (!persisted) defects.push('Remote fixture persistence failure');
          } finally { await fresh.close(); }
        }
      } catch (error) {
        await observed.finish(); normalRuns.push({ channel, status: 'INCOMPLETE', errorCategory: error instanceof Error ? error.name : 'UNKNOWN', currentPath: new URL(page.url()).pathname,
          consoleErrors: observed.consoleErrors, crashes: observed.crashes, failedRequests: observed.failed, failedSameOriginResponses: observed.network,
          webSocketErrors: observed.webSocketErrors, scannedResponses: observed.scannedResponses, secretFindings: observed.leaks });
        defects.push(`${channel}: remote browser check incomplete`);
      } finally { await context.close(); await edge?.close(); }
    }
    await evidence('test24-remote', { status: responsive.some(x => x.screenshot) ? 'FAIL' : 'PASS', checks: responsive });
    await evidence('remote', { status: defects.length ? 'FAIL' : 'PASS', workspaceId, ownedRemoteAccount: true, normalRuns, responsive, defects,
      paidRequests: 0, remoteProductsOrJobsCreated: 0, localFakeProvidersEnabledOnRemote: false });
    expect(defects, 'Remote acceptance defects (see remote.json)').toEqual([]);
  } finally { await a.dispose(); await db.end(); }
});
