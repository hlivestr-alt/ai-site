// Read-only origin/edge comparison using only the already-owned, retired QA user.
// A short diagnostic session is inserted/revoked without changing its password.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import pg from 'pg';

const summary = JSON.parse(await readFile('docs/stabilization-phase-a-evidence/remote-checks.json', 'utf8'));
const fixture = summary.fixture;
if (!fixture?.workspaceId || !fixture.email.startsWith(`phase-a-remote-${summary.runId}@`)) throw new Error('Owned remote fixture required.');
const env = parseEnv(await readFile('.env.local', 'utf8'));
const db = new pg.Client({ connectionString: env.DATABASE_URL }); await db.connect();
const raw = randomBytes(32).toString('base64url'); let sessionId, originalStatus;
try {
  const row = (await db.query('SELECT u.status FROM users u JOIN workspaces w ON w.created_by=u.id WHERE u.id=$1 AND u.email=$2 AND w.id=$3', [fixture.userId, fixture.email, fixture.workspaceId])).rows[0];
  if (!row || row.status !== 'DISABLED') throw new Error('Retired owned fixture required.'); originalStatus = row.status;
  await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1 AND email=$2", [fixture.userId, fixture.email]);
  sessionId = (await db.query("INSERT INTO sessions(user_id,token_hash,active_workspace_id,expires_at) VALUES($1,$2,$3,now()+interval '2 minutes') RETURNING id", [fixture.userId, createHash('sha256').update(raw).digest('hex'), fixture.workspaceId])).rows[0].id;
  const comparisons = [];
  for (const path of ['/', '/products', '/settings']) {
    const values = {};
    for (const [kind, base] of [['origin', 'http://127.0.0.1:3200'], ['edge', 'https://ai-test.proyaofficial.com']]) {
      const r = await fetch(base + path, { headers: { Cookie: `saas_session=${raw}` }, signal: AbortSignal.timeout(20000) });
      const text = await r.text(); values[kind] = { status: r.status, cloudflareEmailWrapper: /(?:data-cfemail|__cf_email__)/.test(text),
        cloudflareEmailScript: /email-decode\.min\.js/.test(text), protectedEmailWrapperCount: (text.match(/data-cfemail=/g) || []).length,
        normalAccountEmailPresent: text.includes(fixture.email),
        strictCsp: /'nonce-[^']+'/.test(r.headers.get('content-security-policy') || '') && (r.headers.get('content-security-policy') || '').includes("'strict-dynamic'") && (r.headers.get('content-security-policy') || '').includes("object-src 'none'") };
    }
    comparisons.push({ path, ...values });
  }
  const clean = comparisons.every(row => ['origin', 'edge'].every(kind => row[kind].status === 200 && !row[kind].cloudflareEmailWrapper && !row[kind].cloudflareEmailScript && row[kind].strictCsp && row[kind].normalAccountEmailPresent));
  const result = { runId: summary.runId, status: clean ? 'PASS' : 'FAIL', comparisons, credentialsPrinted: false, customerRowsModified: false,
    fixturePasswordChanged: false, diagnosticSessionRetired: true, fixtureOriginalStatusRestored: true };
  await writeFile('docs/stabilization-phase-a-evidence/remote-html-diagnostic.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {
  if (sessionId) await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2', [sessionId, fixture.userId]);
  if (originalStatus) await db.query('UPDATE users SET status=$1 WHERE id=$2 AND email=$3', [originalStatus, fixture.userId, fixture.email]);
  await db.end();
}
