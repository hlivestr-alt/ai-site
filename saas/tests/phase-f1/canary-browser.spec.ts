import { test, expect, chromium } from '@playwright/test';
import { fixture, ownedReal, ready, close, invoke, stats, base, evidence } from './support';
import {providerBrowserAudit as observe} from './browser-audit';
for (const channel of ['chrome', 'msedge'] as const) {
    test(`${channel}: only exact approved fake-real canary enables one-click Send Campaign`, async () => {
        const f = await fixture('1000', `canary-${channel}`), browser = await chromium.launch({ channel });
        try {
            const real = await ownedReal(f), ticket = await ready(f, real, false), context = await browser.newContext({ baseURL: base, storageState: await f.c.storageState() }), page = await context.newPage(), observed = await observe(page);
            try {
                await page.goto('/outreach/new');
                await page.getByLabel('Outbound account', { exact: true }).selectOption(real.id);
                await expect(page.getByRole('button', { name: 'Send Campaign', exact: true })).toBeDisabled();
                expect(invoke('approve', f, ticket.id)).toMatchObject({ approved: true });
                await page.reload();
                await expect(page.getByLabel('Outbound account', { exact: true })).toHaveValue(real.id);
                await expect(page.getByLabel('Recipient target', { exact: true })).toHaveValue('1');
                await expect(page.getByLabel('Recipient target', { exact: true })).toBeDisabled();
                await expect(page.getByLabel('Campaign message', { exact: true })).toBeDisabled();
                await expect(page.getByRole('button', { name: 'Send Campaign', exact: true })).toBeEnabled();
                await page.getByRole('button', { name: 'Send Campaign', exact: true }).click();
                await expect(page).toHaveURL(/\/outreach\/[0-9a-f-]+$/);
                invoke('tick');
                await page.reload();
                await expect(page.getByText('Charged: 10 Tokens', { exact: false })).toBeVisible();
                expect((await stats(f, real.id)).message_calls).toBe(1);
                await observed.finish();
                expect(observed.crashes).toEqual([]);
                expect(observed.consoleErrors).toEqual([]);
                expect(observed.leaks).toEqual([]);expect(observed.providerLeaks).toEqual([]);
                await evidence(`provider-canary-ui-${channel}`, { status: 'PASS', unapprovedDisabled: true, exactApprovedConfiguration: true, oneClick: true, simulatedMessageCalls: 1, capturedTokens: 10, externalMessages: 0 });
            }
            finally {
                await context.close();
            }
        }
        finally {
            await browser.close();
            await close(f);
        }
    });
}
