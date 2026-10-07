import { test, expect, chromium } from '@playwright/test';
import { fixture, admit, drain, close, base, evidence, launch, killOwned } from './support';
import { observe } from '../stabilization/browser-checks';
for (const channel of ['chrome', 'msedge'] as const) {
    test(`${channel}: four Outreach pages at desktop/tablet/mobile in light/dark, with one-click sending`, async () => {
        test.setTimeout(300000);
        const f = await fixture(), browser = await chromium.launch({ channel }), checks = [];
        let worker: ReturnType<typeof launch> | undefined;
        try {
            const saved = await admit(f, { targetCount: 1 });
            expect(await drain(f, saved.id)).toBe('COMPLETED');
            for (const colorScheme of ['light', 'dark'] as const) {
                for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
                    const context = await browser.newContext({ baseURL: base, viewport, colorScheme, storageState: await f.c.storageState() });
                    const page = await context.newPage(), observed = await observe(page);
                    try {
                        for (const [path, heading] of [['/outreach', 'Outreach'], ['/outreach/new', 'New Campaign'], [`/outreach/${saved.id}`, f.config.name], ['/outreach/channels', 'Outbound accounts']]) {
                            await page.goto(path);
                            await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
                            if (path === '/outreach/new')
                                await expect(page.getByRole('button', { name: 'Send Campaign', exact: true })).toBeEnabled();
                            const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
                            expect(overflow.scroll, `${path} fits ${viewport.width}`).toBeLessThanOrEqual(overflow.width + 1);
                            await page.screenshot({ path: `docs/phase-e-evidence/outreach-${channel}-${viewport.width}-${colorScheme}-${/^\/outreach\/[0-9a-f-]{36}$/.test(path)?'detail':path.split('/').at(-1)}.png`, fullPage: true });
                            checks.push({ page: path.startsWith('/outreach/') && !['/outreach/new', '/outreach/channels'].includes(path) ? 'campaign-detail' : path, viewport, colorScheme, overflow: false });
                        }
                        if (viewport.width === 1440 && colorScheme === 'light') {
                            await page.goto('/outreach/new');
                            await page.getByLabel('Campaign name', { exact: true }).fill(`${channel} browser QA`);
                            await page.getByLabel('Recipient target', { exact: true }).fill('3');
                            await page.getByLabel('Campaign message', { exact: true }).fill('Hello {{creator_display_name}}, controlled QA only.');
                            await expect(page.getByRole('button', { name: 'Send Campaign', exact: true })).toBeEnabled();
                            const key = await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k => k.startsWith('outreach-draft:'))!)!).key);
                            await page.reload();
                            await expect(page.getByLabel('Campaign name', { exact: true })).toHaveValue(`${channel} browser QA`);
                            expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k => k.startsWith('outreach-draft:'))!)!).key)).toBe(key);
                            await expect(page.getByRole('button', { name: 'Send Campaign', exact: true })).toBeEnabled();
                            await page.getByRole('button', { name: 'Send Campaign', exact: true }).click();
                            await expect(page).toHaveURL(/\/outreach\/[0-9a-f-]+$/);
                            await page.getByRole('button', { name: 'Pause', exact: true }).click();
                            await expect(page.locator('.outreach-status .pill')).toHaveText('Paused');
                            await page.getByRole('button', { name: 'Resume', exact: true }).click();
                            worker = launch('', `${channel}-browser-worker`);
                            await expect(page.locator('.outreach-status .pill')).toHaveText('Completed', { timeout: 30000 });
                            await expect(page.getByText('Started:', { exact: false })).toBeVisible();
                            await expect(page.getByText('Completed:', { exact: false })).toBeVisible();
                            await expect(page.getByText('Charged: 30 Tokens', { exact: false })).toBeVisible();
                            await page.getByRole('button', { name: 'View message', exact: true }).first().click();
                            await expect(page.getByText('Saved message for', { exact: false })).toBeVisible();
                            killOwned(worker.child);
                            worker = undefined;
                        }
                        await observed.finish();
                        expect(observed.crashes).toEqual([]);
                        expect(observed.consoleErrors).toEqual([]);
                        expect(observed.network).toEqual([]);
                        expect(observed.leaks).toEqual([]);
                    }
                    finally {
                        await context.close();
                    }
                }
            }
            await evidence(`outreach-browser-${channel}`, { status: 'PASS', actualInstalledBrowser: true, checks, oneClickCustomerSubmission: true, pauseResume: true, backgroundWorker: true, secretLeaks: 0, consoleErrors: 0, realSends: 0 });
        }
        finally {
            killOwned(worker?.child);
            await browser.close();
            await close(f);
        }
    });
    test(`${channel}: a lost admission reply recovers the same campaign even when all candidates are reserved; insufficient Tokens disable Send`, async () => {
        const f = await fixture(), poor = await fixture('5'), browser = await chromium.launch({ channel });
        const context = await browser.newContext({ baseURL: base, storageState: await f.c.storageState() }), page = await context.newPage();
        try {
            await page.goto('/outreach/new');
            await page.getByLabel('Recipient target', { exact: true }).fill('12');
            await expect(page.getByRole('button', { name: 'Send Campaign', exact: true })).toBeEnabled();
            const endpoint = `**/api/workspaces/${f.workspaceId}/outreach/campaigns`;
            let committedId = '';
            await page.route(endpoint, async (route) => { const response = await route.fetch(); expect(response.status()).toBe(201); committedId = (await response.json()).campaign.id; await route.abort('aborted'); });
            await page.getByRole('button', { name: 'Send Campaign', exact: true }).click();
            await expect.poll(() => committedId, { timeout: 20000 }).not.toBe('');
            await expect(page.locator('.notice.error[role=alert]')).toBeVisible();
            expect(committedId).not.toBe('');
            await page.unroute(endpoint);
            await page.reload();
            await expect(page.getByRole('link', { name: 'Open campaign', exact: true })).toHaveAttribute('href', `/outreach/${committedId}`);
            await expect(page.getByRole('button', { name: 'Send Campaign', exact: true })).toBeDisabled();
            expect((await f.db.query('SELECT count(*)::int n FROM outreach_campaigns WHERE workspace_id=$1', [f.workspaceId])).rows[0].n).toBe(1);
            for (const table of ['outreach_recipients', 'outreach_deliveries', 'outreach_outbox'])
                expect((await f.db.query(`SELECT count(*)::int n FROM ${table} WHERE campaign_id=$1`, [committedId])).rows[0].n).toBe(12);
            expect((await f.db.query("SELECT count(*)::int n FROM token_ledger_entries l JOIN outreach_campaign_billing b ON b.quote_id=l.quote_id WHERE b.campaign_id=$1 AND l.entry_type='RESERVE'", [committedId])).rows[0].n).toBe(1);
            await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${committedId}/control`, { data: { action: 'cancel' } });
            const poorContext = await browser.newContext({ baseURL: base, storageState: await poor.c.storageState() }), poorPage = await poorContext.newPage(), observed = await observe(poorPage);
            try {
                await poorPage.goto('/outreach/new');
                await expect(poorPage.getByText('Required:', { exact: false })).toBeVisible();
                await expect(poorPage.getByText('Available:', { exact: false })).toBeVisible();
                await expect(poorPage.getByRole('button', { name: 'Send Campaign', exact: true })).toBeDisabled();
                await observed.finish();
                expect(observed.consoleErrors).toEqual([]);
                expect(observed.crashes).toEqual([]);
                expect(observed.leaks).toEqual([]);
            }
            finally {
                await poorContext.close();
            }
            await evidence(`outreach-lost-response-${channel}`, { status: 'PASS', intentionalAbortedReply: true, reloadRecoveredSameCampaign: true, allCandidatesAlreadyReserved: true, campaigns: 1, recipients: 12, deliveries: 12, reservations: 1, insufficientTokensButtonDisabled: true, realSends: 0 });
        }
        finally {
            await page.unrouteAll({ behavior: 'ignoreErrors' });
            await context.close();
            await browser.close();
            await close(f);
            await close(poor);
        }
    });
}
test('Unknown delivery is visible and the customer reconciliation action cannot invent an outcome', async ({ page }) => {
    const f = await fixture();
    try {
        await f.db.query("UPDATE outreach_creators SET test_outcome='UNKNOWN_PENDING' WHERE channel_id=$1 AND creator_key='qa_creator_012'", [f.channel.id]);
        const c = await admit(f, { targetCount: 1 });
        expect(await drain(f, c.id)).toBe('DELIVERY_UNKNOWN');
        await page.context().addCookies((await f.c.storageState()).cookies);
        const o = await observe(page);
        await page.goto(`/outreach/${c.id}`);
        await expect(page.locator('.outreach-status .pill')).toHaveText('Waiting for delivery status');
        await page.getByRole('button', { name: 'Check delivery status', exact: true }).click();
        await expect(page.getByText('Delivery is still uncertain. No message has been resent.', { exact: true })).toBeVisible();
        expect((await f.db.query('SELECT attempt_count FROM outreach_deliveries WHERE campaign_id=$1', [c.id])).rows[0].attempt_count).toBe(1);
        await o.finish();
        expect(o.consoleErrors).toEqual([]);
        expect(o.crashes).toEqual([]);
        expect(o.leaks).toEqual([]);
        await f.db.query("UPDATE outreach_test_receipts SET status='NOT_SENT' WHERE delivery_id IN(SELECT id FROM outreach_deliveries WHERE campaign_id=$1)", [c.id]);
        await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/control`, { data: { action: 'cancel' } });
        await f.c.post(`/api/workspaces/${f.workspaceId}/outreach/campaigns/${c.id}/reconcile`, { data: {} });
        await evidence('outreach-unknown-customer', { status: 'PASS', visibleUnknown: true, serverProofOnly: true, noAutomaticResend: true, realSends: 0 });
    }
    finally {
        await close(f);
    }
});
