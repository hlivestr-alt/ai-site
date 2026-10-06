import { test, expect, request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { base, database, digest, evidence, fixtures, login, browserContext, password, snapshot } from './support';
import { source, submit, provision, worker, dispatch, lease, type Claim } from '../clipper-helpers';

function storageClient() { return new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION,
  forcePathStyle: true, credentials: { accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY!, secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY! } }); }
const safeError = (text: string) => !/ECONNREFUSED|PostgreSQL|Traceback|Error:\s|C:\\|\/tmp\/|localhost:\d+|127\.0\.0\.1:\d+|WAVESPEED_API_KEY|WORKER_TOKEN|Authorization:\s*Bearer|workspaces\/[0-9a-f-]+\/.*(?:original|upload)/i.test(text);

test('20 invalid upload matrix, unchanged wallet/jobs, valid controls, and cleanup policy', async () => {
  const f = await fixtures(), c = await login(f.email), db = await database(), s3 = storageClient();
  const checks: Record<string, unknown>[] = [], failures: string[] = [];
  try {
    const before = (await db.query("SELECT (SELECT count(*) FROM jobs) jobs,(SELECT count(*) FROM provider_executions) providers,(SELECT count(*) FROM worker_leases) leases,(SELECT count(*) FROM token_ledger_entries) ledger")).rows[0];
    const walletBefore = (await db.query('SELECT available_tokens::text,reserved_tokens::text FROM billing_account_wallets WHERE billing_account_id=(SELECT billing_account_id FROM workspaces WHERE id=$1)', [f.workspaceId])).rows[0];
    const product = await c.post(`/api/workspaces/${f.workspaceId}/products`, { data: { brand: 'Boundary fixtures', name: 'Invalid upload boundary', category: 'QA', description: '', keySellingPoints: [], targetAudience: '' } });
    expect(product.status()).toBe(201); const productId = (await product.json()).product.id;
    const root = `/api/workspaces/${f.workspaceId}/products/${productId}/assets`;
    const cases = [
      { name: 'text-renamed-mp4', mime: 'video/mp4', filename: 'renamed.mp4', bytes: Buffer.from('This is plain text, not a video.') },
      { name: 'unsupported-gif', mime: 'image/gif', filename: 'unsupported.gif', bytes: Buffer.from('GIF89a123456') },
      { name: 'zero-image', mime: 'image/png', filename: 'empty.png', bytes: Buffer.alloc(0) },
      { name: 'zero-video', mime: 'video/mp4', filename: 'empty.mp4', bytes: Buffer.alloc(0) },
      { name: 'mime-content-mismatch', mime: 'image/jpeg', filename: 'wrong.jpg', bytes: await readFile('tests/fixtures/fake-video.mp4') },
      { name: 'corrupt-png-header', mime: 'image/png', filename: 'corrupt.png', bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]) },
      { name: 'corrupt-mp4-ftyp-only', mime: 'video/mp4', filename: 'corrupt.mp4', bytes: Buffer.from('xxxxftypisomJUNKJUNK') },
      { name: 'synthetic-oversize-image', mime: 'image/png', filename: 'large.png', bytes: Buffer.alloc(1), declared: 32769 },
      { name: 'synthetic-oversize-video', mime: 'video/mp4', filename: 'large.mp4', bytes: Buffer.alloc(1), declared: 65537 },
    ];
    const failedVersions: string[] = [];
    for (const item of cases) {
      const r = await c.post(`${root}/upload-intents`, { data: { purpose: item.mime.startsWith('video') ? 'PRODUCT_VIDEO' : 'OTHER',
        mimeType: item.mime, byteSize: item.declared ?? item.bytes.length, filename: item.filename, permissionConfirmed: true, sourceType: 'CUSTOMER_OWNED' } });
      let status = r.status(), state = 'NO_RECORD';
      if (status === 201) {
        const intent = (await r.json()).intent;
        const put = await fetch(intent.uploadUrl, { method: 'PUT', headers: intent.requiredHeaders, body: new Uint8Array(item.bytes) });
        expect(put.status, 'Isolated storage upload status').toBe(200);
        const done = await c.post(`${root}/${intent.assetId}/versions/${intent.versionId}/finalize`, { data: {} }); status = done.status();
        const text = await done.text();
        if (!safeError(text)) failures.push(`${item.name}: unsafe error response`);
        const version = (await db.query('SELECT status FROM asset_versions WHERE id=$1', [intent.versionId])).rows[0]; state = version.status;
        if (state === 'FAILED') failedVersions.push(intent.versionId);
        if (state === 'READY') failures.push(`${item.name}: corrupt Product asset became READY`);
      } else if (!safeError(await r.text())) failures.push(`${item.name}: unsafe intent error`);
      checks.push({ boundary: 'product', case: item.name, httpStatus: status, state });
      if (status < 400) failures.push(`${item.name}: invalid Product file accepted`);
    }
    for (const item of cases.filter(x => x.mime.startsWith('video'))) {
      const r = await c.post(`/api/workspaces/${f.workspaceId}/sources`, { data: { filename: item.filename, mimeType: item.mime, byteSize: item.declared ? 1048577 : item.bytes.length } });
      let status = r.status(), state = 'NO_RECORD';
      if (status === 201) {
        const intent = await r.json();
        expect((await fetch(intent.uploadUrl, { method: 'PUT', headers: intent.requiredHeaders, body: new Uint8Array(item.bytes) })).status).toBe(200);
        const done = await c.post(`/api/workspaces/${f.workspaceId}/sources/${intent.source.id}/finalize`, { data: {} }); status = done.status(); state = (await done.json()).status;
        if (state === 'UPLOADED' || state === 'VERIFIED') {
          failures.push(`${item.name}: corrupt Clipper source accepted as ${state}`);
          const create = await submit(c, f.workspaceId, intent.source.id, `boundary-${randomUUID()}`);
          checks.push({ case: item.name, boundary: 'source-job', httpStatus: create.status(), createdJob: create.status() === 201 });
          if (create.status() === 201) {
            const jobId = (await create.json()).job.id; failures.push(`${item.name}: Clipper job and token reservation created for corrupt source`);
            const billing = (await db.query('SELECT status,token_amount::text FROM job_billing WHERE job_id=$1', [jobId])).rows[0];
            checks.push({ boundary: 'corrupt-source-billing', jobCreated: true, billingStatusBeforeHarnessCancellation: billing.status, tokensReserved: billing.token_amount });
            // Cancel only this isolated fixture to release its reservation before other checks.
            await c.post(`/api/workspaces/${f.workspaceId}/jobs/${jobId}/cancel`, { data: {} }); dispatch();
          }
        }
      }
      checks.push({ boundary: 'source', case: item.name, httpStatus: status, state });
    }
    const tooLarge = await c.post(`${root}/upload-intents`, { data: { note: 'x'.repeat(17000) } });
    checks.push({ boundary: 'json-request', case: 'actual-17KB-body', httpStatus: tooLarge.status() });
    if (tooLarge.status() !== 413) failures.push('Oversized JSON request not rejected');
    const cookie = (await c.storageState()).cookies.find(x => x.name === 'saas_session')!;
    const streamed = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < 5; i++) controller.enqueue(Buffer.alloc(4096, 32)); controller.close(); } });
    const streamedResponse = await fetch(base + `${root}/upload-intents`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: `saas_session=${cookie.value}` },
      body: streamed, duplex: 'half' } as RequestInit & { duplex: 'half' });
    checks.push({ boundary: 'streamed-json-request', bytes: 20480, contentLengthDeclared: false, httpStatus: streamedResponse.status });
    if (streamedResponse.status !== 413) failures.push('Streamed oversized JSON request not rejected');
    // Exercise actual binary enforcement with small, isolated configured limits.
    const overBytes = Buffer.alloc(32769, 65), over = await c.post(`${root}/upload-intents`, { data: { purpose: 'OTHER', mimeType: 'image/png', byteSize: 32768, filename: 'size.png', permissionConfirmed: true } });
    expect(over.status()).toBe(201); const oi = (await over.json()).intent;
    expect((await fetch(oi.uploadUrl, { method: 'PUT', headers: oi.requiredHeaders, body: overBytes })).status).toBe(200);
    const overDone = await c.post(`${root}/${oi.assetId}/versions/${oi.versionId}/finalize`, { data: {} });
    checks.push({ boundary: 'actual-object-size', httpStatus: overDone.status(), uploadedBytes: overBytes.length, testLimitBytes: 32768 });
    if (overDone.status() !== 422) failures.push('Oversized binary object not rejected');
    failedVersions.push(oi.versionId);
    // Use an existing valid PNG as control, with a path-like/unicode/control-character filename.
    const valid = (await db.query('SELECT storage_key FROM asset_versions WHERE id=$1', [f.assetVersionId])).rows[0];
    const pngObject = await s3.send(new GetObjectCommand({ Bucket: process.env.TEST_OBJECT_STORAGE_BUCKET, Key: valid.storage_key }));
    const png = Buffer.from(await pngObject.Body!.transformToByteArray());
    const weird = await c.post(`${root}/upload-intents`, { data: { purpose: 'OTHER', mimeType: 'image/png', byteSize: png.length,
      filename: '../图像 "<script>qa</script>\u0000.png', sha256: digest(png), permissionConfirmed: true } });
    expect(weird.status()).toBe(201); const wi = (await weird.json()).intent;
    expect((await fetch(wi.uploadUrl, { method: 'PUT', headers: wi.requiredHeaders, body: png })).status).toBe(200);
    const validDone = await c.post(`${root}/${wi.assetId}/versions/${wi.versionId}/finalize`, { data: {} }); expect(validDone.status()).toBe(200);
    const validDownload = await c.get(`${root}/${wi.assetId}/download`); expect(validDownload.status()).toBe(200);
    const downloaded = await fetch((await validDownload.json()).url);
    expect(digest(Buffer.from(await downloaded.arrayBuffer()))).toBe(digest(png));
    checks.push({ boundary: 'valid-unusual-filename', finalized: true, exactBytesPreserved: true, responseHeaderSafe: !/[\r\n]/.test(downloaded.headers.get('content-disposition') || '') });
    // Run the existing cleanup against aged, owned failed uploads in the NEW database/bucket only.
    await db.query("UPDATE asset_versions SET created_at=now()-interval '25 hours' WHERE id=ANY($1::uuid[])", [failedVersions]);
    execFileSync(process.execPath, ['scripts/cleanup-pending.mjs', '--apply', '--test'], { env: { ...process.env, APP_ENV: 'local' }, stdio: 'pipe', windowsHide: true });
    let failedObjectsRetained = 0;
    const versions = (await db.query('SELECT upload_key FROM asset_versions WHERE id=ANY($1::uuid[])', [failedVersions])).rows;
    for (const version of versions) try { await s3.send(new HeadObjectCommand({ Bucket: process.env.TEST_OBJECT_STORAGE_BUCKET, Key: version.upload_key })); failedObjectsRetained++; } catch {}
    checks.push({ boundary: '24-hour-cleanup', failedVersions: failedVersions.length, failedStagingObjectsRetained: failedObjectsRetained });
    if (failedObjectsRetained) failures.push('Cleanup leaves validation-failed staging objects after retention');
    const after = (await db.query("SELECT (SELECT count(*) FROM jobs) jobs,(SELECT count(*) FROM provider_executions) providers,(SELECT count(*) FROM worker_leases) leases,(SELECT count(*) FROM token_ledger_entries) ledger")).rows[0];
    const walletAfter = (await db.query('SELECT available_tokens::text,reserved_tokens::text FROM billing_account_wallets WHERE billing_account_id=(SELECT billing_account_id FROM workspaces WHERE id=$1)', [f.workspaceId])).rows[0];
    checks.push({ boundary: 'side-effects', before, after, walletBefore, walletAfter, providerSubmissionsUnchanged: before.providers === after.providers, privateWorkerLeasesUnchanged: before.leases === after.leases });
    await evidence('test20', { status: failures.length ? 'FAIL' : 'PASS', checks, failures });
    expect(failures, 'File validation acceptance defects (see test20.json)').toEqual([]);
  } finally { s3.destroy(); await c.dispose(); await db.end(); }
});

test('21 object-scoped signatures, expiry, fresh authorization and Content record retention', async () => {
  const f = await fixtures(), a = await login(f.email), b = await login(f.otherEmail), db = await database(), s3 = storageClient();
  const checks: Record<string, unknown>[] = [];
  try {
    const path = `/api/workspaces/${f.workspaceId}/products/${f.productId}/assets/${f.assetId}/download`;
    const r = await a.get(path); expect(r.status()).toBe(200); const url = (await r.json()).url;
    const u = new URL(url); expect(u.searchParams.has('X-Amz-Expires')).toBe(true); expect(u.searchParams.has('X-Amz-Signature')).toBe(true);
    const publicCredential = u.searchParams.get('X-Amz-Credential')!.split('/')[0];
    const signingSecretExposed = publicCredential === process.env.OBJECT_STORAGE_SECRET_KEY;
    expect((await fetch(url)).status).toBe(200);
    const tampered = new URL(url); tampered.searchParams.set('X-Amz-Signature', '0'.repeat(64)); expect((await fetch(tampered)).status).toBe(403);
    const unsigned = new URL(url); unsigned.search = ''; expect((await fetch(unsigned)).status).toBe(403);
    const otherObject = (await db.query('SELECT storage_key FROM source_assets WHERE id=$1', [f.sourceId])).rows[0].storage_key;
    const transformed = new URL(url); transformed.pathname = `/${process.env.TEST_OBJECT_STORAGE_BUCKET}/${otherObject}`; expect((await fetch(transformed)).status).toBe(403);
    const listing = new URL(url); listing.pathname = `/${process.env.TEST_OBJECT_STORAGE_BUCKET}`; listing.searchParams.set('list-type', '2'); expect((await fetch(listing)).status).toBe(403);
    expect((await b.get(path)).status()).toBe(404);
    let derivedCredentialAccessStatus: number | null = null, remoteDerivedCredentialAccessStatus: number | null = null;
    if (signingSecretExposed) {
      const second = await source(b, f.otherWorkspaceId);
      const secondKey = (await db.query('SELECT storage_key FROM source_assets WHERE id=$1 AND workspace_id=$2', [second.id, f.otherWorkspaceId])).rows[0].storage_key;
      // Both credential inputs come ONLY from object A's public signed URL.
      // The requested object B belongs to a different controlled QA workspace.
      const exposed = new S3Client({ endpoint: process.env.OBJECT_STORAGE_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION,
        forcePathStyle: true, credentials: { accessKeyId: publicCredential, secretAccessKey: publicCredential } });
      try { const forged = await getSignedUrl(exposed, new GetObjectCommand({ Bucket: process.env.TEST_OBJECT_STORAGE_BUCKET, Key: secondKey }), { expiresIn: 60 }); derivedCredentialAccessStatus = (await fetch(forged)).status; }
      finally { exposed.destroy(); }
      const real = parseEnv(await readFile('.env.local', 'utf8'));
      if (real.OBJECT_STORAGE_PUBLIC_ENDPOINT) {
        const remote = new S3Client({ endpoint: real.OBJECT_STORAGE_PUBLIC_ENDPOINT, region: process.env.OBJECT_STORAGE_REGION,
          forcePathStyle: true, credentials: { accessKeyId: publicCredential, secretAccessKey: publicCredential } });
        try { const forged = await getSignedUrl(remote, new GetObjectCommand({ Bucket: process.env.TEST_OBJECT_STORAGE_BUCKET, Key: secondKey }), { expiresIn: 60 }); remoteDerivedCredentialAccessStatus = (await fetch(forged, { signal: AbortSignal.timeout(15000) })).status; }
        finally { remote.destroy(); }
      }
    }
    const before = (await a.get(`/api/workspaces/${f.workspaceId}/content/${f.aiContentId}`)); expect(before.status()).toBe(200);
    const v = (await db.query('SELECT a.storage_key FROM content_versions v JOIN job_artifacts a ON a.id=v.artifact_id WHERE v.content_item_id=$1', [f.aiContentId])).rows[0];
    const expires = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.TEST_OBJECT_STORAGE_BUCKET, Key: v.storage_key }), { expiresIn: 1 });
    expect((await fetch(expires)).status).toBe(200); await new Promise(r => setTimeout(r, 2200)); expect((await fetch(expires)).status).toBe(403);
    const detail = await a.get(`/api/workspaces/${f.workspaceId}/content/${f.aiContentId}`); expect(detail.status()).toBe(200); const content = (await detail.json()).content;
    const fresh = await a.get(`/api/workspaces/${f.workspaceId}/content/${f.aiContentId}/versions/${content.version.id}/media`); expect(fresh.status()).toBe(200); expect((await fetch((await fresh.json()).url)).status).toBe(200);
    checks.push({ signatureAndExpiryPresent: true, signingSecretExposed, publicAccessKeyEqualsSigningSecret: signingSecretExposed, derivedCredentialAccessStatus, remoteDerivedCredentialAccessStatus,
      forgedAccessUsedOnlyControlledObjectInDifferentQAWorkspace: true, originalStatus: 200, tamperedStatus: 403, unsignedStatus: 403, objectSubstitutionStatus: 403,
      listingStatus: 403, foreignWorkspaceStatus: 404, testOnlyTTLSeconds: 1, expiredStatus: 403, contentRecordPreserved: true, freshAuthenticatedMediaStatus: 200, customerTTLChanged: false });
    await evidence('test21', { status: signingSecretExposed ? 'FAIL' : 'PASS', checks, failures: signingSecretExposed ? ['Public credential identifier equals signing secret; signed URL supplies credentials for signing another object URL.'] : [] });
    expect(signingSecretExposed, 'Public access-key identifier must differ from the signing secret').toBe(false);
  } finally { await a.dispose(); await b.dispose(); await db.end(); s3.destroy(); }
});

test('22 local server revocation, Back, direct routes, expiry and client credential storage', async ({ browser }) => {
  const f = await fixtures(), context = await browserContext(browser, f), page = await context.newPage(), db = await database();
  try {
    await page.goto('/'); await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Products', exact: false }).click();
    await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
    const cookies = await context.cookies(), cookie = cookies.find(x => x.name === 'saas_session')!;
    expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe('Lax');
    const html = await page.content(), stores = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, visibleCookies: document.cookie }));
    expect(html.includes(cookie.value) || stores.includes(cookie.value), 'Credential in client-visible content/storage').toBe(false);
    const old = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base, Cookie: `saas_session=${cookie.value}` } });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.waitForURL('**/login');
    expect((await old.get('/api/auth/session')).status()).toBe(401);
    expect((await old.get(`/api/workspaces/${f.workspaceId}/products`)).status()).toBe(401);
    await page.goBack();
    const afterBackAPI = (await context.request.get(`/api/workspaces/${f.workspaceId}/products`)).status(); expect(afterBackAPI).toBe(401);
    await page.reload(); await expect(page).toHaveURL(/\/login$/);
    await page.goto('/settings'); await expect(page).toHaveURL(/\/login$/);
    const revoked = (await db.query('SELECT count(*)::int count FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1 AND revoked_at IS NOT NULL', [f.email])).rows[0].count;
    expect(revoked).toBeGreaterThan(0);
    const fresh = await login(f.email), session = (await fresh.storageState()).cookies.find(x => x.name === 'saas_session')!;
    await db.query('UPDATE sessions SET expires_at=now()-interval \'1 second\' WHERE token_hash=$1', [digest(Buffer.from(session.value))]);
    expect((await fresh.get('/api/auth/session')).status()).toBe(401);
    await old.dispose(); await fresh.dispose();
    await evidence('test22-local', { status: 'PASS', httpOnly: true, sameSite: 'Lax', localSecureCookie: cookie.secure, revokedAPI: 401, expiredAPI: 401,
      afterBackAPI, reloadRequiresAuthentication: true, directProtectedRouteRedirects: true, serverSideRevocation: true, credentialInHTMLOrClientStorage: false });
  } finally { await context.close(); await db.end(); }
});

test('25 safe validation/storage/SQL errors and private-worker error boundaries', async ({ browser }) => {
  const f = await fixtures(), c = await login(f.email), db = await database();
  const checks: Record<string, unknown>[] = [], failures: string[] = [];
  let cleanupTrigger = false, workerId: string | undefined;
  try {
    for (const [path, data] of [
      ['/api/auth/login', { email: 'unknown-master@example.test', password: 'invalid' }],
      [`/api/workspaces/${f.workspaceId}/products`, { name: '' }],
      [`/api/workspaces/${f.workspaceId}/sources`, { filename: 'bad.mp4', mimeType: 'video/mp4', byteSize: 0 }],
    ] as [string, Record<string, unknown>][]) {
      const r = await c.post(path, { data }); const text = await r.text(); checks.push({ path, status: r.status(), safeError: safeError(text) });
      if (!safeError(text)) failures.push(`${path}: unsafe expected-error response`);
    }
    await db.query("CREATE FUNCTION master_qa_reject_product() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.brand='QA_DATABASE_FAILURE' THEN RAISE EXCEPTION 'PostgreSQL fixture error ECONNREFUSED /private/qa'; END IF; RETURN NEW; END $$");
    await db.query('CREATE TRIGGER master_qa_reject_product BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION master_qa_reject_product()'); cleanupTrigger = true;
    const sql = await c.post(`/api/workspaces/${f.workspaceId}/products`, { data: { brand: 'QA_DATABASE_FAILURE', name: 'Injected SQL failure', category: 'QA', description: '', keySellingPoints: [], targetAudience: '' } });
    checks.push({ boundary: 'SQL-fault', status: sql.status(), safeError: safeError(await sql.text()) }); expect(sql.status()).toBe(500);
    if (!safeError(await sql.text())) failures.push('Product endpoint exposed controlled SQL fault');
    const gateway = process.env.MASTER_QA_GATEWAY!;
    if (!gateway.startsWith('master-qa-gateway-')) throw new Error('Owned gateway name required.');
    try {
      execFileSync('docker', ['stop', gateway], { stdio: 'pipe', windowsHide: true });
      const unavailable = await c.get(`/api/workspaces/${f.workspaceId}/products/${f.productId}/assets/${f.assetId}/download`);
      const safe = safeError(await unavailable.text()); checks.push({ boundary: 'storage-connection-refused', status: unavailable.status(), safeError: safe });
      if (!safe) failures.push('Download endpoint exposed storage connection internals');
    } finally {
      execFileSync('docker', ['start', gateway], { stdio: 'pipe', windowsHide: true });
      for (let n = 0; n < 30; n++) { try { if ((await fetch('http://127.0.0.1:9017/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
    }
    const src = await source(c, f.workspaceId), submitted = await submit(c, f.workspaceId, src.id, `qa-error-${randomUUID()}`); expect(submitted.status()).toBe(201);
    const jobId = (await submitted.json()).job.id, w = provision(`master-errors-${Date.now()}`); workerId = w.workerId; const wc = await worker(w.credential); dispatch();
    try {
      const claim = (await (await wc.post('/api/worker/claim', { data: {} })).json()).claim as Claim; expect(claim.jobId).toBe(jobId);
      const disallowedMarker = 'Traceback File C:\\private\\pipeline.py; WORKER_TOKEN=synthetic-placeholder';
      const disallowed = await wc.post(`/api/worker/jobs/${jobId}/progress`, { data: { ...lease(claim), sequence: 1, percent: 20, stage: 'TRANSCRIBING', message: disallowedMarker } });
      checks.push({ boundary: 'worker-punctuation-filter', status: disallowed.status(), unsafePathPayloadRejected: disallowed.status() === 400 }); expect(disallowed.status()).toBe(400);
      const marker = 'ECONNREFUSED 127.0.0.1:9999; PostgreSQL RuntimeError Traceback; WORKER_TOKEN synthetic-placeholder';
      const progress = await wc.post(`/api/worker/jobs/${jobId}/progress`, { data: { ...lease(claim), sequence: 1, percent: 20, stage: 'TRANSCRIBING', message: marker } });
      expect(progress.status()).toBe(200);
      const running = await c.get(`/api/workspaces/${f.workspaceId}/clipper/${jobId}`);
      const progressUnsafe = !safeError(await running.text()); checks.push({ boundary: 'worker-progress', path: `/api/workspaces/:workspaceId/clipper/:jobId`, rawInternalsVisible: progressUnsafe });
      if (progressUnsafe) failures.push('Clipper progress endpoint passes private-worker internals to customer');
      const failed = await wc.post(`/api/worker/jobs/${jobId}/fail`, { data: { ...lease(claim), errorCode: 'QA_SYNTHETIC_FAILURE', retriable: false, message: marker } }); expect(failed.status()).toBe(200);
      const detail = await c.get(`/api/workspaces/${f.workspaceId}/clipper/${jobId}`); const unsafe = !safeError(await detail.text());
      if (unsafe) failures.push('Clipper failed-job endpoint passes private-worker internals to customer');
      const context = await browser.newContext({ baseURL: base, storageState: await c.storageState() }), page = await context.newPage();
      await page.goto(`/clipper/${jobId}`); await expect(page.getByText('FAILED', { exact: true }).first()).toBeVisible();
      const body = await page.locator('body').innerText(); const uiUnsafe = !safeError(body);
      if (uiUnsafe) failures.push('Clipper failed-job page renders private-worker internals');
      checks.push({ boundary: 'worker-failure', rawInternalsInHTTP: unsafe, rawInternalsInUI: uiUnsafe, markerWasSynthetic: true, realCredentialExposed: false });
      await context.close();
    } finally { await wc.dispose(); }
    await evidence('test25', { status: failures.length ? 'FAIL' : 'PASS', checks, failures });
    expect(failures, 'Customer error acceptance defects (see test25.json)').toEqual([]);
  } finally {
    if (workerId) await db.query("UPDATE workers SET status='DISABLED' WHERE id=$1", [workerId]);
    if (cleanupTrigger) { await db.query('DROP TRIGGER IF EXISTS master_qa_reject_product ON products'); await db.query('DROP FUNCTION IF EXISTS master_qa_reject_product()'); }
    await c.dispose(); await db.end();
  }
});

test('28 persisted account, memberships, products, references, wallet, histories, artifacts and Content after a new login', async ({ browser }) => {
  const f = await fixtures(), c = await login(f.email); const before = await snapshot(c, f);
  expect((await c.post('/api/auth/logout', { data: {} })).status()).toBe(200); await c.dispose();
  const context = await browser.newContext({ baseURL: base }), page = await context.newPage();
  try {
    await page.goto('/login'); await page.getByLabel('Email address').fill(f.email); await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /Sign in/ }).click(); await page.waitForURL(base + '/'); await page.reload();
    const after = await snapshot(context.request, f);
    expect(after, 'Persisted customer-visible snapshots').toEqual(before);
    const video = (after.video as { job: { artifacts: { id: string }[] } }).job;
    const clip = (after.clips as { job: { result: { clips: { artifactId: string }[] } } }).job;
    expect(video.artifacts.length).toBeGreaterThan(0); expect(clip.result.clips.length).toBeGreaterThan(0);
    const downloads = [
      `/api/workspaces/${f.workspaceId}/ai-videos/${f.aiJobId}/artifacts/${video.artifacts[0].id}/download`,
      `/api/workspaces/${f.workspaceId}/clipper/${f.clipJobId}/artifacts/${clip.result.clips[0].artifactId}/download`,
      `/api/workspaces/${f.workspaceId}/sources/${f.sourceId}/download`,
    ];
    for (const path of downloads) { const r = await context.request.get(path); expect(r.status()).toBe(200); expect((await fetch((await r.json()).url)).status).toBe(200); }
    await evidence('test28-local', { status: 'PASS', compared: Object.keys(before), newBrowserContext: true, freshFormLogin: true, exactAPISnapshotsPreserved: true,
      signedArtifactAndSourceDownloads: 3, outreach: 'NOT IMPLEMENTED / separate future phase', paidGenerations: 0 });
  } finally { await context.close(); }
});
