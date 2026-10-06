// Never emits matched text, line contents, credentials, cookies, or signed URLs.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';

export async function configuredSecrets() {
  const found = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (/SECRET|TOKEN|PASSWORD|ENCRYPTION_KEY|API_KEY/.test(key) && value?.length >= 8 && !/^(test|fake|fixture|replace|change|example|your[-_])/i.test(value)) found.push({ category: key, value });
  }
  for (const file of ['.env.local', '.env', '../worker-agent/.env', '../worker-agent/.env.local', '../app/.env.local', '../h3-bridge/.env.local']) {
    let values; try { values = parseEnv(await readFile(file, 'utf8')); } catch { continue; }
    for (const [key, value] of Object.entries(values)) {
      if (/^(WAVESPEED_API_KEY|WORKER_TOKEN|.*(?:SECRET|SECRET_KEY|PASSWORD|ENCRYPTION_KEY|API_KEY|PRIVATE_KEY|CALLBACK_TOKEN|WEBHOOK_TOKEN))$/.test(key) && value.length >= 8 && !/^(test|fake|fixture|replace|change|example|your[-_])/i.test(value)) found.push({ category: key, value });
      if (/DATABASE_URL$/.test(key)) try { const u = new URL(value); if (u.password?.length >= 4) found.push({ category: `DATABASE_PASSWORD (${file})`, value: decodeURIComponent(u.password) }); } catch {}
    }
  }
  return found;
}
export function scanText(text, secrets) {
  const result = new Set();
  for (const secret of secrets) {
    if (!text.includes(secret.value)) continue;
    // Short, low-entropy database fixture passwords can also be ordinary words
    // in documentation/framework code. Require an actual credential context.
    if (secret.category.startsWith('DATABASE_PASSWORD') && secret.value.length < 12) {
      const escaped = secret.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const uri = new RegExp(`postgres(?:ql)?://[^\\s/@:]+:${escaped}@`);
      const assignment = new RegExp(`(?:POSTGRES_PASSWORD|DB_PASSWORD|DATABASE_PASSWORD|password)\\s*[:=]\\s*['\"]?${escaped}(?:['\"]|[\\s;,]|$)`);
      if (!uri.test(text) && !assignment.test(text)) continue;
    }
    result.add(secret.category);
  }
  // Concrete credential formats; environment variable references alone are not leaks.
  if (/\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/.test(text)) result.add('API_KEY_FORMAT');
  if (/\bAKIA[A-Z0-9]{16}\b/.test(text)) result.add('AWS_ACCESS_KEY_FORMAT');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) result.add('PRIVATE_KEY');
  return [...result];
}
async function audit() {
  const root = resolve('..'), secrets = await configuredSecrets();
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
  const findings = []; let inspected = 0, binaries = 0;
  for (const file of tracked) {
    let bytes; try { bytes = await readFile(resolve(root, file)); } catch { continue; }
    if (bytes.includes(0) || bytes.length > 10 * 1024 * 1024) { binaries++; continue; }
    inspected++;
    for (const category of scanText(bytes.toString('utf8'), secrets)) findings.push({ source: 'tracked-working-tree', file, category, valueDetected: true });
    if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) findings.push({ source: 'tracked-working-tree', file, category: 'TRACKED_ENV_FILE', valueDetected: true });
  }
  for (const file of staged) {
    try {
      const bytes = execFileSync('git', ['show', `:${file}`], { cwd: root, windowsHide: true }), text = bytes.toString('utf8');
      for (const category of scanText(text, secrets)) findings.push({ source: 'staged-index', file, category, valueDetected: true });
      if (/https?:\/\/[^\s"'<>`]+[?&]X-Amz-(?:Credential|Signature|Security-Token)=/i.test(text)) findings.push({ source: 'staged-index', file, category: 'SIGNED_OBJECT_URL', valueDetected: true });
    } catch {}
  }
  let envIgnored = false;
  try { execFileSync('git', ['check-ignore', 'saas/.env.local', 'worker-agent/.env'], { cwd: root, stdio: 'pipe', windowsHide: true }); envIgnored = true; } catch {}
  const result = { status: findings.length || !envIgnored ? 'FAIL' : 'PASS', trackedFiles: tracked.length, inspectedTextFiles: inspected, excludedBinaryFiles: binaries,
    stagedFiles: staged.length, envIgnored, configuredSecretCategories: [...new Set(secrets.map(s => s.category))], findings };
  await mkdir('test-data/stabilization-phase-b', { recursive: true }); await mkdir('docs/stabilization-phase-b-evidence', { recursive: true });
  await writeFile('test-data/stabilization-phase-b/secret-audit.json', JSON.stringify(result, null, 2));
  await writeFile('docs/stabilization-phase-b-evidence/secret-audit.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); process.exitCode = result.status === 'PASS' ? 0 : 1;
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/secret-audit.mjs')) void audit();
