import { test, expect, chromium } from '@playwright/test';
import { fixture, ownedReal, ready, close, drain, stats, base, evidence } from './support';
import { admit } from '../phase-e/support';
import {providerBrowserAudit as observe} from './browser-audit';
for (const browserChannel of ['chrome', 'msedge'] as const) {
    test(`${browserChannel}: connection/reauth/disconnect/TEST/readiness/default-off states fit all three viewports`, async () => {
        test.setTimeout(300000);
        const f = await fixture(), browser = await chromium.launch({ channel: browserChannel });
        try {
            const saved = await admit(f, { targetCount: 1 });
            expect(await drain(f, saved.id)).toBe('COMPLETED');
            const real = await ownedReal(f);
            await ready(f, real, false);
            const checks = [];
            for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
                const context = await browser.newContext({ baseURL: base, viewport, storageState: await f.c.storageState() }), page = await context.newPage(), observed = await observe(page);
                let credentialLeak = false;
                page.on('response', async (r) => { if (r.url().startsWith(base) && /json|html|javascript/.test(r.headers()['content-type'] || ''))
                    try {
                        if (/fixture_access_|fixture_refresh_|fixture_cipher_|"credential_reference"|"provider_identity"|"ciphertext"/.test(await r.text()))
                            credentialLeak = true;
                    }
                    catch { } });
                try {
                    for (const [state, status, certification] of [['connected', 'CONNECTED', 'NOT_TESTED'], ['needs-reauth', 'NEEDS_REAUTH', 'NOT_TESTED'], ['disconnected', 'DISCONNECTED', 'NOT_TESTED'], ['real-channel-ready', 'CONNECTED', 'NOT_TESTED'], ['real-send-disabled', 'CONNECTED', 'NOT_TESTED'], ['canary-ready', 'CONNECTED', 'CANARY_READY']] as const) {
                        await f.db.query('UPDATE outreach_channels SET status=$1,outbound_capable=false,certification=$2 WHERE id=$3', [status, certification, real.id]);
                        for (const [path, heading] of [['/outreach', 'Outreach'], ['/outreach/new', 'New Campaign'], [`/outreach/${saved.id}`, f.config.name], ['/outreach/channels', 'Outbound accounts']]) {
                            await page.goto(path);
                            await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
                            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
                            if (path === '/outreach/channels') {
                                await expect(page.getByText('TEST account · no external messages', { exact: true })).toBeVisible();
                                await expect(page.getByText('TEST provider fixture · no external messages', { exact: true })).toBeVisible();
                                const card = page.locator('.review-card').filter({ has: page.getByText('Controlled owned shop', { exact: true }) });
                                await expect(card.getByText(status === 'NEEDS_REAUTH' ? 'Needs reauthorization' : status === 'DISCONNECTED' ? 'Disconnected' : 'Connected', { exact: true })).toBeVisible();
                                await expect(card.getByText('Real sending disabled · no bulk campaigns', { exact: true })).toBeVisible();
                                if (state === 'canary-ready')
                                    await expect(card.getByText('Canary prepared · awaiting operator approval', { exact: true })).toBeVisible();
                                expect(await page.locator('input[type=password]').count()).toBe(0);
                                await page.screenshot({ path: `docs/phase-f-evidence/provider-${browserChannel}-${viewport.width}-${state}.png`, fullPage: true });
                            }
                            checks.push({ state, page: /^\/outreach\/[0-9a-f-]+$/.test(path) ? 'campaign-detail' : path, viewport, overflow: false });
                        }
                    }
                    await observed.finish();
                    expect(credentialLeak).toBe(false);
                    expect(observed.crashes).toEqual([]);
                    expect(observed.consoleErrors).toEqual([]);
                    expect(observed.network).toEqual([]);
                    expect(observed.leaks).toEqual([]);expect(observed.providerLeaks).toEqual([]);
                }
                finally {
                    await context.close();
                }
            }
            expect((await stats(f, real.id)).message_calls).toBe(0);
            await evidence(`provider-browser-${browserChannel}`, { status: 'PASS', actualBrowser: true, browserVersion: browser.version(), checks, syntheticExplicit: true, realSendingDisabled: true, credentialFields: 0, credentialLeaks: 0, realMessages: 0 });
        }
        finally {
            await browser.close();
            await close(f);
        }
    });
}
