// Test-host only. Credential values and signed URLs stay in process memory.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { execFileSync } from 'node:child_process';
import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const file = '.env.local', text = await readFile(file, 'utf8'), env = { ...process.env, ...parseEnv(text) };
if (!['local', 'test'].includes(env.APP_ENV) || env.OBJECT_STORAGE_ENDPOINT !== 'http://127.0.0.1:9000' || env.OBJECT_STORAGE_PUBLIC_ENDPOINT !== 'https://storage-test.proyaofficial.com') throw new Error('Rotation requires the explicitly configured remote-test host');
execFileSync('git', ['check-ignore', file], { stdio: 'pipe', windowsHide: true });
const old = { accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY, secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY };
const fresh = { accessKeyId: `saas-test-${randomBytes(12).toString('hex')}`, secretAccessKey: randomBytes(48).toString('base64url') };
const client = (endpoint, credentials) => new S3Client({ endpoint, region: env.OBJECT_STORAGE_REGION, credentials, forcePathStyle: true });
const oldS3 = client(env.OBJECT_STORAGE_ENDPOINT, old), oldPublic = client(env.OBJECT_STORAGE_PUBLIC_ENDPOINT, old);
const bucket = `phase-a-rotation-${Date.now()}`, key = 'controlled-object', bytes = Buffer.from('Stabilization Phase A controlled credential-rotation proof');
let currentS3 = oldS3, created = false;
const result = { rotated: false, secretPrinted: false, signingSecretEntropyBits: 384, credentialsDistinct: true, paidOperations: 0 };
async function inventory(s3, name) {
  const hash = createHash('sha256'); let token, count = 0;
  do { const r = await s3.send(new ListObjectsV2Command({ Bucket: name, ContinuationToken: token })); for (const o of r.Contents || []) { hash.update(JSON.stringify([o.Key, o.ETag, o.Size])); count++; } token = r.IsTruncated ? r.NextContinuationToken : undefined; } while (token);
  return { count, fingerprint: hash.digest('hex') };
}
const status = async url => (await fetch(url, { signal: AbortSignal.timeout(20000) })).status;
try {
  const names = [...new Set([env.OBJECT_STORAGE_BUCKET, env.TEST_OBJECT_STORAGE_BUCKET].filter(Boolean))];
  const before = await Promise.all(names.map(n => inventory(oldS3, n)));
  await oldS3.send(new CreateBucketCommand({ Bucket: bucket })); created = true;
  await oldS3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'text/plain' }));
  const oldUrl = await getSignedUrl(oldS3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
  const oldRemoteUrl = await getSignedUrl(oldPublic, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
  result.oldUrlBeforeRotation = await status(oldUrl);
  if (result.oldUrlBeforeRotation !== 200) throw new Error('Controlled old-signature baseline failed');
  if (!/^OBJECT_STORAGE_ACCESS_KEY=/m.test(text) || !/^OBJECT_STORAGE_SECRET_KEY=/m.test(text)) throw new Error('Private credential entries are missing');
  const updated = text.replace(/(^OBJECT_STORAGE_ACCESS_KEY=)[^\r\n]*/m, `$1${fresh.accessKeyId}`).replace(/(^OBJECT_STORAGE_SECRET_KEY=)[^\r\n]*/m, `$1${fresh.secretAccessKey}`);
  await writeFile(file, updated, { mode: 0o600 });
  env.OBJECT_STORAGE_ACCESS_KEY = fresh.accessKeyId; env.OBJECT_STORAGE_SECRET_KEY = fresh.secretAccessKey;
  execFileSync('docker', ['compose', '--env-file', file, 'up', '-d', '--no-deps', '--force-recreate', 'object-gateway'], { env, stdio: 'pipe', windowsHide: true });
  currentS3 = client(env.OBJECT_STORAGE_ENDPOINT, fresh);
  const newPublic = client(env.OBJECT_STORAGE_PUBLIC_ENDPOINT, fresh);
  const newUrl = await getSignedUrl(currentS3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 });
  const newRemoteUrl = await getSignedUrl(newPublic, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 });
  for (let i = 0; i < 30; i++) { try { if ((await fetch('http://127.0.0.1:9000/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
  result.oldLocalUrlAfterRotation = await status(oldUrl);
  result.oldRemoteUrlAfterRotation = await status(oldRemoteUrl);
  const oldMinted = await getSignedUrl(oldPublic, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 300 });
  result.oldCredentialsNewlyMintedUrl = await status(oldMinted);
  result.newLocalUrl = await status(newUrl); result.newRemoteUrl = await status(newRemoteUrl);
  result.publicIdentifierEqualsSecret = decodeURIComponent(new URL(newRemoteUrl).searchParams.get('X-Amz-Credential')).split('/')[0] === fresh.secretAccessKey;
  result.unsignedRemoteListing = await status(`${env.OBJECT_STORAGE_PUBLIC_ENDPOINT}/${bucket}?list-type=2`);
  const transformed = new URL(newRemoteUrl); transformed.pathname = `/${bucket}`; transformed.searchParams.set('list-type', '2'); result.objectToListingTransformation = await status(transformed);
  const after = await Promise.all(names.map(n => inventory(currentS3, n)));
  result.existingBucketsPreserved = JSON.stringify(before) === JSON.stringify(after);
  result.existingObjectCounts = before.map(r => r.count);
  result.rotated = result.oldLocalUrlAfterRotation === 403 && result.oldRemoteUrlAfterRotation === 403 && result.oldCredentialsNewlyMintedUrl === 403 && result.newLocalUrl === 200 && result.newRemoteUrl === 200 && !result.publicIdentifierEqualsSecret && result.unsignedRemoteListing === 403 && result.objectToListingTransformation === 403 && result.existingBucketsPreserved;
  newPublic.destroy();
  if (!result.rotated) process.exitCode = 1;
} catch {
  result.error = 'ROTATION_OR_VERIFICATION_FAILED'; process.exitCode = 1;
} finally {
  if (created) {
    try { await currentS3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); await currentS3.send(new DeleteBucketCommand({ Bucket: bucket })); result.controlledFixtureDeleted = true; }
    catch { result.controlledFixtureDeleted = false; }
  }
  oldS3.destroy(); oldPublic.destroy(); if (currentS3 !== oldS3) currentS3.destroy();
  await mkdir('docs/stabilization-phase-a-evidence', { recursive: true });
  await writeFile('docs/stabilization-phase-a-evidence/storage-rotation.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
