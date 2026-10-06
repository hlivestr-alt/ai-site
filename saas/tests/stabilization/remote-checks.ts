// Controlled REMOTE-TEST verification. No inference endpoint is ever invoked.
import { chromium, request, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import pg from 'pg';
import sharp from 'sharp';
import { hashPassword } from '../../src/lib/core';
import { inputHash, type AiVideoInput } from '../../src/lib/job-core';
import { objectStorage } from '../../src/lib/storage';
import { publishJobContent } from '../../src/lib/content-publication';
import { contentPosterBatch } from '../../src/lib/content-posters';
import { pool } from '../../src/lib/db';
import { WaveSpeedVideoProvider } from '../../src/lib/video-providers/wavespeed';
import { observe, mediaChecks } from './browser-checks';

async function main() {
const privateEnv = parseEnv(await readFile('.env.local', 'utf8')); Object.assign(process.env, privateEnv);
if (process.env.APP_ENV !== 'local' || process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT !== 'https://storage-test.proyaofficial.com') throw new Error('REMOTE-TEST configuration required');
const base = 'https://ai-test.proyaofficial.com', runId = `${Date.now()}-${randomBytes(3).toString('hex')}`;
const email = `phase-a-remote-${runId}@example.test`, password = `PhaseA!${randomBytes(24).toString('base64url')}`;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
const c = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
const result: Record<string, unknown> = { runId, paidInference: 0, outreach: 0, credentialsPrinted: false, authenticatedBrowserRuns: [] };
let userId = '', workspaceId = '', productId = '', contentId = '';
let failure = false;
async function hydrated(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('form')).some(form => { const key = Object.keys(form).find(k => k.startsWith('__reactProps$')); return key && typeof (form as unknown as Record<string, { onSubmit?: unknown }>)[key]?.onSubmit === 'function'; }), { timeout: 25000 });
}
try {
  userId = (await db.query("INSERT INTO users(email,display_name,password_hash,status,email_verified_at) VALUES($1,'Phase A remote QA',$2,'ACTIVE',now()) RETURNING id", [email, await hashPassword(password)])).rows[0].id;
  expect((await c.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
  const created = await c.post('/api/workspaces', { data: { name: `Phase A remote QA ${runId}` } }); expect(created.status()).toBe(201); workspaceId = (await created.json()).workspace.id;
  result.fixture = { userId, workspaceId, email, controlledAccount: true, verificationDeliveryBypassedOnlyForFixture: true };
  const p = await c.post(`/api/workspaces/${workspaceId}/products`, { data: { brand: 'Phase A', name: 'Storage rotation fixture', category: 'QA', description: 'Owned, synthetic, unpaid acceptance fixture.', keySellingPoints: ['Controlled test reference'], targetAudience: 'QA' } }); expect(p.status()).toBe(201); productId = (await p.json()).product.id;
  const png = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#ed6748' } }).png().toBuffer();
  for (const channel of ['chrome', 'msedge'] as const) {
    const browser = await chromium.launch({ channel, headless: true }), context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), o = await observe(page, base); const rows: Record<string, unknown> = { channel, browserVersion: browser.version() };
    try {
      rows.activeCheck='form-login'; await page.goto('/login'); await hydrated(page); await page.getByLabel('Email address').fill(email); await page.getByLabel('Password').fill(password);
      const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST'), page.getByRole('button', { name: /Sign in/ }).click()]); expect(response.status()).toBe(200); await page.waitForURL(u => !u.pathname.startsWith('/login'));
      const routes = ['/', '/products', '/ai-videos', '/clipper', '/content', '/settings', '/billing'];
      const edgeChecks = [];
      for (const route of routes) {
        const response = await page.goto(route); expect(response?.status()).toBe(200); await expect(page.locator('main')).toBeVisible();
        const html = await response!.text(), csp = response!.headers()['content-security-policy'] || '', scriptPolicy = csp.split(';').find(s => s.trim().startsWith('script-src ')) || '';
        const check = { route, emailTransformationInjected: /data-cfemail|__cf_email__|email-decode\.min\.js/.test(html), strictCsp: /'nonce-[^']+'/.test(scriptPolicy) && scriptPolicy.includes("'strict-dynamic'") && !scriptPolicy.includes("'unsafe-inline'") && csp.includes("object-src 'none'") };
        edgeChecks.push(check); if (check.emailTransformationInjected || !check.strictCsp) failure = true;
        if (route === '/settings') { rows.normalAccountEmailVisible = (await page.locator('main').innerText()).includes(email); if (!rows.normalAccountEmailVisible) failure = true; }
      }
      rows.routes = routes; rows.edgeChecks = edgeChecks;
      await page.goto(`/products/${productId}/edit?step=assets`); await hydrated(page);
      const uploadRoot = `/api/workspaces/${workspaceId}/products/${productId}/assets`;
      const intent = await c.post(uploadRoot + '/upload-intents', { data: { filename: 'credential-control.png', mimeType: 'image/png', byteSize: png.length, purpose: 'OTHER', sourceType: 'CUSTOMER_OWNED', permissionConfirmed: true } }); expect(intent.status()).toBe(201);
      const diagnostic = (await intent.json()).intent; const u = new URL(diagnostic.uploadUrl), publicId = u.searchParams.get('X-Amz-Credential')!.split('/')[0];
      rows.signerUsesRotatedIdentifier = publicId === privateEnv.OBJECT_STORAGE_ACCESS_KEY;
      rows.publicIdentifierEqualsCurrentSecret = publicId === privateEnv.OBJECT_STORAGE_SECRET_KEY;
      rows.signedUploadStatus = (await fetch(diagnostic.uploadUrl, { method: 'PUT', headers: diagnostic.requiredHeaders, body: png })).status;
      if (!rows.signerUsesRotatedIdentifier || rows.signedUploadStatus !== 200) { rows.browserProductUpload = 'BLOCKED_STALE_SAAS_CONFIGURATION'; failure = true; }
      else {
        const validVideo = await readFile('tests/fixtures/clipper-output.mp4');
        for (const item of [{ name: `phase-a-${channel}.png`, mime: 'image/png', purpose: 'FRONT', bytes: png }, { name: `phase-a-${channel}.mp4`, mime: 'video/mp4', purpose: 'PRODUCT_VIDEO', bytes: validVideo }]) {
          rows.activeCheck='reference-purpose'; await page.getByLabel('Reference purpose').selectOption(item.purpose); rows.activeCheck='source-field'; await page.getByLabel('Source', { exact: false }).selectOption('CUSTOMER_OWNED'); rows.activeCheck='file-input'; await page.locator('#asset-file').setInputFiles({ name: item.name, mimeType: item.mime, buffer: item.bytes }); await page.getByRole('checkbox', { name: 'I confirm I have permission to use this media.' }).check();
          rows.activeCheck='browser-upload-finalization'; const finalized = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/finalize') && r.request().method() === 'POST'); await page.getByRole('button', { name: 'Upload reference', exact: true }).click(); expect((await finalized).status()).toBe(200); await expect(page.getByText('Reference uploaded and verified.', { exact: true })).toBeVisible();
          await expect(page.getByText(item.name, { exact: true })).toBeVisible();
        }
        rows.browserProductUpload = 'PASS';
        const detail = await (await c.get(`/api/workspaces/${workspaceId}/products/${productId}`)).json(); const downloads = [];
        for (const asset of detail.assets.filter((a: { status: string }) => a.status === 'READY')) { const r = await c.get(`${uploadRoot}/${asset.id}/download`); expect(r.status()).toBe(200); const value = (await r.json()).url; expect((await fetch(value)).status).toBe(200); downloads.push({ type: asset.type, status: 200 }); }
        rows.productDownloads = downloads;
      }
      rows.faviconStatus = (await c.get('/favicon.ico')).status();
      await o.finish(); Object.assign(rows, { uncaught: o.crashes, consoleErrors: o.consoleErrors, networkFailures: o.network, requestFailures: o.failed, secretFindings: o.leaks, scannedResponses: o.scannedResponses });
      rows.hydrationClean = o.crashes.length === 0 && !o.consoleErrors.some(s => /hydration|email-decode|418/.test(s));
      if (!rows.hydrationClean || rows.faviconStatus !== 200 || rows.publicIdentifierEqualsCurrentSecret || o.leaks.length || o.consoleErrors.length || o.network.length || o.failed.length) failure = true;
    } catch (error) { failure = true; rows.errorCategory = error instanceof Error ? error.name : 'UNKNOWN'; await o.finish(); Object.assign(rows, { uncaught: o.crashes, consoleErrors: o.consoleErrors, networkFailures: o.network, secretFindings: o.leaks }); }
    finally { (result.authenticatedBrowserRuns as unknown[]).push(rows); await context.close(); await browser.close(); }
  }
  const ready = (await db.query("SELECT a.id AS asset_id,a.purpose,a.type,v.* FROM assets a JOIN asset_versions v ON v.id=a.current_version_id WHERE a.workspace_id=$1 AND a.product_id=$2 AND v.status='READY'", [workspaceId, productId])).rows;
  if (ready.some(a => a.type === 'IMAGE')) {
    const detail = await (await c.get(`/api/workspaces/${workspaceId}/products/${productId}`)).json(), v = detail.version, r = detail.rules;
    const input: AiVideoInput = { schemaVersion: 1, kind: 'AI_VIDEO', product: { id: productId, versionId: v.id, versionNumber: v.version_number, ruleVersionId: r.id, ruleVersionNumber: r.version_number, information: { name: v.name }, rules: {}, assets: ready.filter(a => a.type === 'IMAGE').slice(0, 1).map(a => ({ assetId: a.asset_id, assetVersionId: a.id, purpose: a.purpose, type: a.type, storageKey: a.storage_key, sha256: a.sha256, byteSize: Number(a.byte_size), mimeType: a.mime_type })) }, customerPrompt: 'Diagnostic static fixture; no inference.', accuracyInstructions: '', tier: 'QUALITY', durationSeconds: 5, aspectRatio: '1:1', quantity: 1, referenceAssetVersionIds: [ready.find(a => a.type === 'IMAGE').id], providerPolicyVersion: 'phase-a-static-diagnostic', executionProvider: 'FAKE' };
    process.env.WAVESPEED_REFERENCE_FETCH_VERIFIED = '1';
    const urls = await new WaveSpeedVideoProvider({ fetch: async (...args) => { if (args[1]?.method && args[1]?.method !== 'GET') throw new Error('Inference calls prohibited'); return fetch(...args); } }).referenceUrls(input);
    result.waveSpeedReferences = { status: 'PASS', referenceCount: urls.length, publicHttps: urls.every(u => new URL(u).protocol === 'https:'), paidProviderRequests: 0 };
    const bytes = await readFile('tests/fixtures/fake-video.mp4'), sha = createHash('sha256').update(bytes).digest('hex'), jobId = randomUUID(), attemptId = randomUUID(), artifactId = randomUUID(), key = `workspaces/${workspaceId}/jobs/${jobId}/artifacts/${artifactId}/video`;
    await objectStorage().put(key, bytes, 'video/mp4');
    await db.query('BEGIN');
    try {
      await db.query("INSERT INTO jobs(id,workspace_id,type,required_capability,input_snapshot,input_hash,idempotency_key,product_id,product_version_id,product_rule_version_id,created_by,max_attempts,billing_mode) VALUES($1,$2,'AI_VIDEO','PHASE_A_STATIC_DIAGNOSTIC',$3::jsonb,$4,$5,$6,$7,$8,$9,1,'DIAGNOSTIC')", [jobId, workspaceId, JSON.stringify(input), inputHash(input), `phase-a-static-${runId}`, productId, v.id, r.id, userId]);
      await db.query("INSERT INTO job_attempts(id,workspace_id,job_id,attempt_number,status,started_at,finished_at) VALUES($1,$2,$3,1,'SUCCEEDED',now(),now())", [attemptId, workspaceId, jobId]);
      await db.query("INSERT INTO job_artifacts(id,workspace_id,job_id,attempt_id,slot_name,status,storage_key,mime_type,expected_byte_size,expected_sha256,byte_size,sha256,duration_seconds,width,height,verified_at) VALUES($1,$2,$3,$4,'video','READY',$5,'video/mp4',$6,$7,$6,$7,1,320,180,now())", [artifactId, workspaceId, jobId, attemptId, key, bytes.length, sha]);
      await db.query("UPDATE jobs SET status='SUCCEEDED',attempt_count=1,progress_percent=100,finished_at=now(),result=$1::jsonb WHERE id=$2", [JSON.stringify({ artifactIds: [artifactId] }), jobId]); await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    contentId = (await publishJobContent(workspaceId, jobId))[0]; await contentPosterBatch(1, (await db.query('SELECT current_version_id FROM content_items WHERE id=$1', [contentId])).rows[0].current_version_id);
    const contentDetail=(await (await c.get(`/api/workspaces/${workspaceId}/content/${contentId}`)).json()).content;
    const download = await c.get(`/api/workspaces/${workspaceId}/content/${contentId}/versions/${contentDetail.version.id}/media?kind=download`); expect(download.status()).toBe(200); expect((await fetch((await download.json()).url)).status).toBe(200);
    const browser = await chromium.launch({ channel: 'chrome', headless: true }), context = await browser.newContext({ baseURL: base, storageState: await c.storageState() });
    try { const page = await context.newPage(); await page.goto(`/content/${contentId}`); await mediaChecks(page); const pending = page.waitForEvent('download'); await page.getByRole('link', { name: /Download/ }).first().click(); const file = await pending; expect(await file.failure()).toBeNull(); result.contentLibraryBrowserDownload = { status: 'PASS', paidInference: 0, staticDiagnosticFixture: true }; } finally { await context.close(); await browser.close(); }
    result.remoteDiagnosticJob = { jobId, billingMode: 'DIAGNOSTIC', tokenLedgerEntries: Number((await db.query('SELECT count(*) FROM token_ledger_entries WHERE job_id=$1', [jobId])).rows[0].count), providerExecutions: Number((await db.query('SELECT count(*) FROM provider_executions WHERE job_id=$1', [jobId])).rows[0].count) };
  } else { result.waveSpeedReferences = { status: 'BLOCKED_STALE_SAAS_CONFIGURATION' }; result.contentLibraryBrowserDownload = { status: 'BLOCKED_STALE_SAAS_CONFIGURATION' }; }
} catch (error) { failure = true; result.errorCategory = error instanceof Error ? error.name : 'UNKNOWN'; }
finally {
  if (userId) { await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]); await db.query("UPDATE users SET status='DISABLED' WHERE id=$1", [userId]); }
  if (productId) await db.query("UPDATE products SET status='ARCHIVED' WHERE id=$1 AND workspace_id=$2", [productId, workspaceId]);
  if (contentId) await db.query("UPDATE content_items SET status='ARCHIVED' WHERE id=$1 AND workspace_id=$2", [contentId, workspaceId]);
  result.status = failure ? 'FAIL' : 'PASS'; result.fixtureSessionsRevoked = true; result.fixtureUserDisabled = true; result.fixtureProductAndContentArchived = true;
  await mkdir('docs/stabilization-phase-a-evidence', { recursive: true }); await writeFile('docs/stabilization-phase-a-evidence/remote-checks.json', JSON.stringify(result, null, 2)); await c.dispose(); await db.end(); await pool().end();
  console.log(JSON.stringify({ status: result.status, browsers: result.authenticatedBrowserRuns, waveSpeedReferences: result.waveSpeedReferences, contentLibraryBrowserDownload: result.contentLibraryBrowserDownload, errorCategory: result.errorCategory, paidInference: 0 }));
}
process.exitCode = failure ? 1 : 0;

}
void main().catch(() => { console.log(JSON.stringify({status:'FAIL',errorCategory:'REMOTE_TEST_SETUP_FAILED',credentialsPrinted:false})); process.exitCode=1; });
