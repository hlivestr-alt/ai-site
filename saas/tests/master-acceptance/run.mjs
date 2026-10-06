// Validation infrastructure only. Owns a new database, bucket, and gateway per run.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { S3Client, CreateBucketCommand, PutBucketCorsCommand, PutPublicAccessBlockCommand,
  ListObjectsV2Command, DeleteObjectsCommand, DeleteBucketCommand, ListMultipartUploadsCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';

process.loadEnvFile('.env.local');
const original = { ...process.env };
const tsconfigOriginal = await readFile('tsconfig.json', 'utf8');
const persistenceOnly = process.argv.includes('--persistence-only');
const runId = `${Date.now()}_${randomBytes(3).toString('hex')}`;
const databaseName = `master_qa_${runId}`;
const bucket = `master-qa-${runId.replaceAll('_', '-')}`;
const gateway = `master-qa-gateway-${runId.replaceAll('_', '-')}`;
const evidenceDir = 'test-data/master-acceptance';
await mkdir(evidenceDir, { recursive: true });
await mkdir('docs/master-acceptance-evidence', { recursive: true });
const adminUrl = new URL(original.TEST_DATABASE_URL);
if (original.TEST_DATABASE_URL === original.DATABASE_URL) throw new Error('Test and customer database must differ.');
const isolatedUrl = new URL(adminUrl); isolatedUrl.pathname = `/${databaseName}`;
const db = new pg.Client({ connectionString: adminUrl.toString() });
const s3 = new S3Client({ endpoint: original.OBJECT_STORAGE_ENDPOINT, region: original.OBJECT_STORAGE_REGION,
  forcePathStyle: true, credentials: { accessKeyId: original.OBJECT_STORAGE_ACCESS_KEY, secretAccessKey: original.OBJECT_STORAGE_SECRET_KEY } });
const owned = { runId, database: databaseName, bucket, gateway, createdDatabase: false, createdBucket: false, createdGateway: false,
  remoteFixture: null, customerHistoryUnchanged: null, cleanup: {}, commands: [], paid: { realVideo: 0, realLLM: 0, outreach: 0 } };
const secrets = [];
for (const [key, value] of Object.entries(original)) if (/KEY|TOKEN|SECRET|PASSWORD/.test(key) && value?.length >= 8) secrets.push(value);
for (const key of ['DATABASE_URL', 'TEST_DATABASE_URL']) { const u = new URL(original[key]); if (u.password) secrets.push(decodeURIComponent(u.password)); }
function redact(value) { let out = String(value); for (const secret of secrets) out = out.split(secret).join('[REDACTED]'); return out; }
const env = { ...original, MASTER_QA_RUN_ID: runId, TEST_DATABASE_URL: isolatedUrl.toString(), DATABASE_URL: isolatedUrl.toString(),
  TEST_OBJECT_STORAGE_BUCKET: bucket, OBJECT_STORAGE_BUCKET: bucket, APP_ENV: 'local', APP_BASE_URL: 'http://127.0.0.1:3217',
  SAAS_TEST_BASE_URL: 'http://127.0.0.1:3217', MASTER_QA_GATEWAY: gateway, OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9017', OBJECT_STORAGE_PUBLIC_ENDPOINT: '',
  OBJECT_STORAGE_ALLOWED_ORIGINS: 'http://127.0.0.1:3217', SAAS_TEST_STORAGE_PORT: '9017', MAIL_MODE: 'development_file',
  VIDEO_PROVIDER: 'fake', ENABLE_FAKE_VIDEO_PROVIDER: '1', CLIP_ANALYZER_PROVIDER: 'fake', ENABLE_FAKE_CLIP_ANALYZER: '1',
  PAYMENT_PROVIDER: 'fake', ENABLE_FAKE_PAYMENT_PROVIDER: '1', ENABLE_TEST_BILLING: '1',
  FAKE_PAYMENT_WEBHOOK_SECRET: 'isolated-master-qa-fixture-webhook', WAVESPEED_API_KEY: '', BYTEPLUS_API_KEY: '', OPENAI_API_KEY: '',
  XENDIT_SECRET_KEY: '', XENDIT_WEBHOOK_TOKEN: '', SMTP_PASSWORD: '', MAX_IMAGE_BYTES: '32768', MAX_VIDEO_BYTES: '65536',
  MAX_CLIPPER_SOURCE_BYTES: '1048576', MASTER_QA_REMOTE_BASE: 'https://ai-test.proyaofficial.com',
};
async function command(label, args, options = {}) {
  const started = Date.now();
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let output = '';
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    child.on('close', code => resolve({ code, output })); child.on('error', () => resolve({ code: 127, output: 'Command could not start.' }));
  });
  await writeFile(`${evidenceDir}/${label}.log`, redact(result.output));
  owned.commands.push({ label, command: `node ${args.join(' ')}`, exitCode: result.code, elapsedSeconds: Math.round((Date.now() - started) / 1000) });
  console.log(`${label}: exit ${result.code}`);
  if (label === 'acceptance') console.log(redact(result.output).slice(-19000));
  return result.code;
}
async function historySnapshot(client) {
  const out = {};
  for (const table of ['jobs', 'job_artifacts', 'source_assets', 'products', 'asset_versions', 'content_items', 'content_versions', 'billing_account_wallets', 'token_ledger_entries']) {
    out[table] = (await client.query(`SELECT count(*)::text AS count, md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY row_to_json(t)::text), '')) AS fingerprint FROM ${table} t WHERE coalesce(to_jsonb(t)->>'workspace_id','') <> $1`, [owned.remoteFixture?.workspaceId || ''])).rows[0];
  }
  return out;
}
let remote;
let exitCode = 0;
try {
  await db.connect();
  await db.query(`CREATE DATABASE "${databaseName}"`); owned.createdDatabase = true;
  await s3.send(new CreateBucketCommand({ Bucket: bucket })); owned.createdBucket = true;
  await s3.send(new PutPublicAccessBlockCommand({ Bucket: bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } }));
  await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [{ AllowedOrigins: [env.APP_BASE_URL], AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['content-type', 'range'], ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'] }] } }));
  const networks = JSON.parse(execFileSync('docker', ['inspect', 'ai-site-saas-object-storage-1', '--format', '{{json .NetworkSettings.Networks}}'], { encoding: 'utf8', windowsHide: true }));
  const network = Object.keys(networks)[0]; if (!network) throw new Error('Existing private storage network missing.');
  const gatewayEnv = { ...env, APP_ENV: 'test' };
  const dockerArgs = ['run', '-d', '--name', gateway, '--label', 'master-acceptance-20-28=owned', '--network', network, '-p', '127.0.0.1:9017:9000',
    '-v', `${process.cwd().replaceAll('\\', '/')}/docker:/app:ro`];
  for (const key of ['APP_ENV', 'SAAS_TEST_STORAGE_PORT', 'OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_PUBLIC_ENDPOINT', 'OBJECT_STORAGE_ALLOWED_ORIGINS', 'OBJECT_STORAGE_REGION', 'OBJECT_STORAGE_ACCESS_KEY', 'OBJECT_STORAGE_SECRET_KEY']) dockerArgs.push('-e', key);
  dockerArgs.push('node:22-alpine', 'node', '/app/s3-gateway.mjs');
  execFileSync('docker', dockerArgs, { env: gatewayEnv, windowsHide: true, stdio: 'pipe' }); owned.createdGateway = true;
  for (let n = 0; n < 30; n++) { try { if ((await fetch('http://127.0.0.1:9017/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
  if (await command('migrations', ['scripts/migrate.mjs', 'up'])) throw new Error('Isolated migration failed.');
  if (await command('billing-seed', ['--import', 'tsx', 'scripts/billing-seed-test.ts'])) throw new Error('Isolated billing fixture seed failed.');
  if (await command('acceptance-discovery', ['node_modules/@playwright/test/cli.js', 'test', '-c', 'playwright.master-acceptance.config.ts', '--list'])) throw new Error('Acceptance test collection failed.');
  // A new, controlled remote identity is seeded; signup delivery is already a known defect.
  // Its password stays only in process memory/environment and it owns no existing data.
  try {
    if (persistenceOnly) throw new Error('Remote fixture intentionally omitted for isolated persistence supplement.');
    remote = new pg.Client({ connectionString: original.DATABASE_URL }); await remote.connect();
    owned.historyBefore = await historySnapshot(remote);
    const email = `master-qa-${runId}@example.test`, password = randomBytes(24).toString('base64url') + 'Aa1!';
    secrets.push(password); const salt = randomBytes(16);
    const hash = `scrypt:${salt.toString('hex')}:${(await promisify(scryptCallback)(password, salt, 64)).toString('hex')}`;
    const user = (await remote.query("INSERT INTO users(email,display_name,password_hash,status,email_verified_at) VALUES($1,'Master QA Remote',$2,'ACTIVE',now()) RETURNING id", [email, hash])).rows[0];
    owned.remoteFixture = { userId: user.id, email, workspaceId: null, status: 'CREATED' };
    env.MASTER_QA_REMOTE_EMAIL = email; env.MASTER_QA_REMOTE_PASSWORD = password; env.MASTER_QA_REMOTE_USER_ID = user.id;
  } catch {
    if (persistenceOnly) owned.remoteScope = 'Intentionally omitted; isolated persistence supplement only.';
    else owned.remoteBlocked = 'Controlled remote identity provisioning unavailable.';
  }
  exitCode = await command('acceptance', ['node_modules/@playwright/test/cli.js', 'test', '-c', 'playwright.master-acceptance.config.ts', ...(persistenceOnly ? ['--grep', '28 persisted'] : [])]);
  const auditExit = await command('secret-audit', ['tests/master-acceptance/secret-audit.mjs'], { env: original });
  if (auditExit && !exitCode) exitCode = auditExit;
} catch (error) {
  exitCode = 2; owned.harnessFailure = error instanceof Error ? error.name : 'UNKNOWN';
  console.log('Acceptance infrastructure failed; see redacted run summary.');
} finally {
  if (remote && owned.remoteFixture) {
    try {
      const record = JSON.parse(await readFile(`${evidenceDir}/remote.json`, 'utf8'));
      owned.remoteFixture.workspaceId = record.workspaceId || null;
    } catch {}
    try {
      await remote.query('UPDATE sessions SET revoked_at=coalesce(revoked_at,now()) WHERE user_id=$1', [owned.remoteFixture.userId]);
      await remote.query("UPDATE users SET status='DISABLED' WHERE id=$1", [owned.remoteFixture.userId]);
      owned.remoteFixture.status = 'DISABLED; sessions revoked; empty fixture workspace retained';
      const after = await historySnapshot(remote); owned.customerHistoryUnchanged = JSON.stringify(after) === JSON.stringify(owned.historyBefore);
      owned.historyAfter = after;
    } catch { owned.cleanup.remote = 'Fixture retirement or history snapshot requires review.'; }
  }
  await remote?.end().catch(() => {});
  if (owned.createdGateway) { try { execFileSync('docker', ['rm', '-f', gateway], { windowsHide: true, stdio: 'pipe' }); owned.cleanup.gateway = 'deleted'; } catch { owned.cleanup.gateway = 'failed'; } }
  if (owned.createdBucket) {
    try {
      let total = 0;
      const multipart = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket }));
      for (const u of multipart.Uploads || []) await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: u.Key, UploadId: u.UploadId }));
      for (;;) {
        const list = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
        if (!list.Contents?.length) break;
        total += list.Contents.length;
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: list.Contents.map(v => ({ Key: v.Key })), Quiet: true } }));
      }
      await s3.send(new DeleteBucketCommand({ Bucket: bucket })); owned.cleanup.bucket = 'deleted'; owned.cleanup.objectsDeleted = total;
    } catch { owned.cleanup.bucket = 'failed'; }
  }
  if (owned.createdDatabase) {
    try {
      const isolated = new pg.Client({ connectionString: isolatedUrl.toString() }); await isolated.connect(); owned.isolatedFixtureCounts = {};
      for (const table of ['users', 'workspaces', 'products', 'assets', 'asset_versions', 'jobs', 'job_artifacts', 'source_assets', 'workers', 'content_items', 'content_versions', 'billing_account_wallets', 'token_ledger_entries', 'workflow_definitions', 'payments']) owned.isolatedFixtureCounts[table] = Number((await isolated.query(`SELECT count(*)::text count FROM ${table}`)).rows[0].count);
      await isolated.end();
    } catch {}
    try { await db.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); owned.cleanup.database = 'deleted'; } catch { owned.cleanup.database = 'failed'; }
  }
  let mailRemoved = 0;
  for (const name of (await readdir('data/mailbox').catch(() => [])).filter(n => n.endsWith('.json'))) {
    try { const mail = JSON.parse(await readFile(`data/mailbox/${name}`, 'utf8')); if (typeof mail.to === 'string' && mail.to.includes(runId) && mail.to.endsWith('@example.test')) { await unlink(`data/mailbox/${name}`); mailRemoved++; } } catch {}
  }
  owned.cleanup.fixtureMailFilesDeleted = mailRemoved;
  await db.end().catch(() => {}); s3.destroy();
  // Next dev may append this harness's generated type paths to tsconfig.json.
  // Restore only its generated include/format changes, preserving other edits.
  try {
    const current = await readFile('tsconfig.json', 'utf8'), currentParsed = JSON.parse(current), originalParsed = JSON.parse(tsconfigOriginal);
    currentParsed.include = currentParsed.include.filter(p => !p.startsWith('.next-tests/master-acceptance/'));
    originalParsed.include = originalParsed.include.filter(p => !p.startsWith('.next-tests/master-acceptance/'));
    if (JSON.stringify(currentParsed) === JSON.stringify(originalParsed)) { await writeFile('tsconfig.json', tsconfigOriginal); owned.cleanup.generatedTsconfigChanges = 'restored'; }
  } catch {}
  const summaryName = persistenceOnly ? 'run-summary-persistence' : 'run-summary';
  await writeFile(`${evidenceDir}/${summaryName}.json`, JSON.stringify(owned, null, 2));
  await writeFile(`docs/master-acceptance-evidence/${summaryName}.json`, JSON.stringify(owned, null, 2));
  console.log(JSON.stringify({ runId, exitCode, cleanup: owned.cleanup, customerHistoryUnchanged: owned.customerHistoryUnchanged, paid: owned.paid }));
}
process.exitCode = exitCode;
