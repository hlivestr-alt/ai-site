import { test, expect, chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { base, fixtures, browserContext, evidence, observe, layout, mediaChecks, evidenceDir } from './support';
import { configuredSecrets, scanText } from './secret-audit.mjs';

for (const channel of ['chrome', 'msedge'] as const) {
  test(`23/26/27 ${channel} critical routing, images, video/clip playback, downloads, response-secret and network audit`, async ({ browser }) => {
    const installed = channel === 'chrome' || existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') || existsSync('C:/Program Files/Microsoft/Edge/Application/msedge.exe');
    if (!installed) { await evidence(`test23-${channel}`, { status: 'BLOCKED', reason: 'Microsoft Edge is not installed; Chromium is not substituted.' }); test.skip(true, 'Microsoft Edge is not installed.'); }
    let edge;
    try { if (channel === 'msedge') edge = await chromium.launch({ channel: 'msedge', headless: true }); }
    catch { await evidence(`test23-${channel}`, { status: 'BLOCKED', reason: 'Playwright could not launch channel=msedge.' }); test.skip(true, 'Microsoft Edge channel cannot launch.'); return; }
    const f = await fixtures(), context = await browserContext(edge || browser, f), page = await context.newPage(), observations = await observe(page);
    const pages: Record<string, unknown>[] = [], downloads: Record<string, unknown>[] = [], metadataChecks: Record<string, unknown>[] = [];
    try {
      // An anonymous context checks Login independently of the authenticated routing below.
      const anonymous = await (edge || browser).newContext({ baseURL: base }), loginPage = await anonymous.newPage();
      await loginPage.goto('/login'); await expect(loginPage.getByLabel('Email address')).toBeVisible(); await expect(loginPage.getByLabel('Password')).toBeVisible(); await anonymous.close();
      await page.goto('/'); await expect(page.locator('h1')).toBeVisible(); pages.push({ path: '/', route: 'PASS' });
      for (const [name, path] of [['Products', '/products'], ['AI Videos', '/ai-videos'], ['Clipper', '/clipper'], ['Content Library', '/content'], ['Settings', '/settings'], ['Billing', '/billing']] as const) {
        await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name, exact: false }).click();
        await expect(page).toHaveURL(new RegExp(`${path}$`)); await expect(page.locator('h1')).toBeVisible();
        expect(await page.locator('body').innerText()).not.toMatch(/Application error|client-side exception|Internal Server Error/);
        pages.push({ path, route: 'PASS', visibleButtons: await page.locator('button:visible').count(), controls: await page.locator('input,textarea,select').count() });
      }
      await page.goto(`/products/${f.productId}`); const image = page.getByAltText('FRONT reference'); await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(v => (v as HTMLImageElement).naturalWidth)).toBeGreaterThan(0); pages.push({ path: '/products/:productId', referenceImageLoaded: true });
      await page.goto(`/products/${f.productId}/edit?step=assets`); await expect(page.locator('input[type=file]')).toBeVisible(); pages.push({ path: '/products/:productId/edit', uploadControlVisible: true });
      for (const [kind, path] of [['video', `/ai-videos/${f.aiJobId}`], ['clip', `/clipper/${f.clipJobId}`], ['content-video', `/content/${f.aiContentId}`], ['content-clip', `/content/${f.clipContentIds[0]}`]]) {
        await page.goto(path); const media = await mediaChecks(page); expect(media.length).toBeGreaterThan(0);
        pages.push({ path: path.replace(/[0-9a-f-]{36}/g, ':id'), kind, media });
        if (kind === 'video' || kind === 'clip') {
          const link = page.getByRole('link', { name: kind === 'video' ? /Download MP4/ : 'Download clip 1', exact: kind === 'clip' }).first(); await expect(link).toBeVisible();
          const url = await link.getAttribute('href'); expect(url?.startsWith('http')).toBe(true);
          const r = await fetch(url!); expect(r.status).toBe(200); const bytes = (await r.arrayBuffer()).byteLength; expect(bytes).toBeGreaterThan(0);
          downloads.push({ kind, authenticatedURLRequestedByPage: true, downloadStatus: r.status, bytes });
        }
        if (kind === 'clip') {
          const secrets = await configuredSecrets();
          for (const label of ['Download transcript', 'Download clip plan']) {
            const link = page.getByRole('link', { name: label, exact: true }); await expect(link).toBeVisible();
            const r = await fetch((await link.getAttribute('href'))!); const text = await r.text(); const findings = scanText(text, secrets);
            expect(r.status).toBe(200); metadataChecks.push({ kind: label, status: r.status, credentialValueDetected: findings.length > 0 });
            for (const category of findings) observations.leaks.push({ source: label, category, valueDetected: true });
          }
        }
      }
      // Observe a completed-job page for duplicate requests / polling storms.
      await page.waitForTimeout(6000); await observations.finish();
      const requestCounts: Record<string, number> = {};
      for (const r of observations.requests) if (r.path.startsWith('/api/')) requestCounts[r.path.replace(/[0-9a-f-]{36}/g, ':id')] = (requestCounts[r.path.replace(/[0-9a-f-]{36}/g, ':id')] || 0) + 1;
      const byActualPath = new Map<string, number[]>();
      for (const r of observations.requests) if (r.path.startsWith('/api/')) byActualPath.set(r.path, [...(byActualPath.get(r.path) || []), r.time]);
      const runaway = [...byActualPath].filter(([, times]) => times.some(start => times.filter(t => t >= start && t < start + 10000).length > 8)).map(([path, times]) => ({ path: path.replace(/[0-9a-f-]{36}/g, ':id'), count: times.length }));
      await evidence(`test23-${channel}`, { status: observations.crashes.length || downloads.length !== 2 ? 'FAIL' : 'PASS', channel, loginForm: 'PASS', pages, downloads, browserVersion: (edge || browser).version() });
      await evidence(`test26-browser-${channel}`, { status: observations.leaks.length ? 'FAIL' : 'PASS', scannedResponses: observations.scannedResponses, metadataChecks, findings: observations.leaks });
      await evidence(`test27-${channel}`, { status: observations.consoleErrors.length || observations.crashes.length || observations.failed.length || observations.network.length || runaway.length ? 'FAIL' : 'PASS',
        consoleErrors: observations.consoleErrors, uncaughtExceptions: observations.crashes, failedRequests: observations.failed, failedSameOriginResponses: observations.network, webSocketErrors: observations.webSocketErrors, requestCounts, runaway });
      expect(observations.crashes, 'Browser JS crash').toEqual([]); expect(observations.leaks, 'Configured secret values in customer responses').toEqual([]);
      expect(observations.consoleErrors, 'Console errors during normal navigation').toEqual([]); expect(observations.failed, 'Failed requests during normal navigation').toEqual([]);
      expect(observations.network, 'Failed same-origin responses').toEqual([]); expect(runaway, 'Runaway polling').toEqual([]);
    } finally { await context.close(); await edge?.close(); }
  });
}

test('24 functional responsive layout at 390x844 and 768x1024, including creation and Product editor', async ({ browser }) => {
  const f = await fixtures(), context = await browserContext(browser, f, { width: 390, height: 844 }), page = await context.newPage();
  const checks: Record<string, unknown>[] = [], failures: Record<string, unknown>[] = [];
  try {
    const anonymous = await browser.newContext({ baseURL: base, viewport: { width: 390, height: 844 } }), login = await anonymous.newPage();
    await login.goto('/login'); const authLayout = await layout(login); checks.push({ viewport: '390x844', path: '/login', ...authLayout });
    await expect(login.getByLabel('Email address')).toBeVisible(); await login.getByLabel('Email address').fill('qa-layout@example.test');
    if (authLayout.documentWidth > 392 || authLayout.clipped.length) { const shot = `${evidenceDir}/responsive-local-login-390.png`; await login.screenshot({ path: shot, fullPage: true }); failures.push({ path: '/login', screenshot: shot, ...authLayout }); }
    await anonymous.close();
    for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      const paths = ['/', '/products', '/products/new', `/products/${f.productId}/edit`, `/products/${f.productId}/edit?step=assets`,
        `/products/${f.productId}/edit?step=rules`, '/ai-videos', '/clipper', '/content', `/content/${f.clipContentIds[0]}`, '/settings', '/billing'];
      for (const path of paths) {
        await page.goto(path); await expect(page.locator('h1')).toBeVisible();
        if (path === '/ai-videos') { await page.getByLabel('Saved Product').selectOption(f.productId); await page.getByLabel('Video prompt').fill('Responsive form test; no generation submitted.'); }
        if (path === '/clipper') { await page.getByLabel('Source video', { exact: true }).selectOption(f.sourceId); await page.getByLabel('Clipping goal').fill('Responsive form test; no clipping submitted.'); }
        await page.waitForTimeout(400);
        const metrics = await layout(page); const normalized = path.replace(/[0-9a-f-]{36}/g, ':id'); checks.push({ viewport, path: normalized, ...metrics });
        if (metrics.documentWidth > viewport.width + 2 || metrics.clipped.length || metrics.navigationLinks < 6) {
          const slug = normalized.replace(/[^a-zA-Z0-9]/g, '-'), screenshot = `${evidenceDir}/responsive-local-${viewport.width}-${slug}.png`;
          await page.screenshot({ path: screenshot, fullPage: true }); failures.push({ viewport, path: normalized, screenshot, ...metrics });
        }
      }
    }
    await evidence('test24-local', { status: failures.length ? 'FAIL' : 'PASS', checks, failures, modals: 'No modal/dialog used by these implemented paths; editor steps are routed pages.', paidSubmissions: 0 });
    expect(failures.map(x => ({ path: x.path, viewport: x.viewport })), 'Meaningful responsive overflow (see test24-local.json/screenshots)').toEqual([]);
  } finally { await context.close(); }
});
