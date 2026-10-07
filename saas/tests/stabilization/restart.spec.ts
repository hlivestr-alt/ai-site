import { test, expect, type APIRequestContext } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { readFile, mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { base, database, evidence, fixtures, login } from './support';
import { source, submit, provision, worker, dispatch, lease, type Claim } from '../clipper-helpers';
import { publishJob } from '../content-helpers';

const workerRoot = resolve('../worker-agent');
async function pauseMarker(work: string, jobId: string, attemptId: string) {
  try { await access(resolve(work, jobId, attemptId, 'phase-a-paused.json')); return true; } catch { return false; }
}
function launch(credential: string, work: string, stage = '') {
  let output = '';
  const child = spawn('python', ['worker_agent.py','--env',resolve(work,'isolated-no-provider.env')], { cwd: workerRoot, windowsHide: true, env: { ...process.env, SAAS_BASE_URL: base, WORKER_TOKEN: credential, WORKER_WORK_DIR: work, WORKER_MAX_CONCURRENCY: '1', WORKER_POLL_SECONDS: '0.2', WORKER_HEARTBEAT_SECONDS: '1', CLIP_ANALYZER_PROVIDER: 'fake', ENABLE_FAKE_CLIP_ANALYZER: '1', WAVESPEED_API_KEY: '', OPENAI_API_KEY: '', PHASE_A_PROCESS_TEST: '1', PHASE_A_PAUSE_STAGE: stage, PYTHONPATH: resolve(workerRoot, 'tests/phase_a_fixtures') }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', b => output += b); child.stderr!.on('data', b => output += b);
  return { child, output: () => output.replaceAll(credential, '[REDACTED]') };
}
function killOwned(child?: ChildProcess) {
  if (child?.pid && child.exitCode === null) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'pipe', windowsHide: true });
}

for (const stage of ['DOWNLOADING_SOURCE', 'TRANSCRIBING', 'ANALYZING_TRANSCRIPT', 'RENDERING', 'UPLOADING_RESULTS', 'FINALIZING']) test(`worker process loss at ${stage} creates a new attempt and completes once`, async () => {
  test.setTimeout(180000);
  const f = await fixtures(), c = await login(f.email), db = await database();
  const before=(await db.query('SELECT a.available_tokens FROM billing_account_wallets a JOIN workspaces w ON w.billing_account_id=a.billing_account_id WHERE w.id=$1',[f.workspaceId])).rows[0].available_tokens;
  const s = await source(c, f.workspaceId), result = await submit(c, f.workspaceId, s.id, crypto.randomUUID(),f.sharedWorkspaceId?{captions:false}:{}); expect(result.status()).toBe(201);
  const jobId = (await result.json()).job.id as string, p = provision(`phase-a-restart-${stage}-${Date.now()}`), w = await worker(p.credential);
  const work = resolve(workerRoot, 'data', `phase-a-${process.env.STABILIZATION_RUN_ID}`, stage); await mkdir(work, { recursive: true });
  let first: ReturnType<typeof launch> | undefined, next: ReturnType<typeof launch> | undefined;
  try {
    dispatch(); first = launch(p.credential, work, stage);
    let claim: Claim | undefined;
    await expect.poll(async () => {
      const row = (await db.query('SELECT j.id AS "jobId",l.attempt_id AS "attemptId",l.id AS "leaseId",l.fencing_token::text AS "fencingToken" FROM jobs j JOIN worker_leases l ON l.job_id=j.id AND l.status=\'ACTIVE\' WHERE j.id=$1', [jobId])).rows[0];
      if (!row) return false; claim = row; return pauseMarker(work, jobId, row.attemptId);
    }, { timeout: 90000, message: 'Owned worker reached interruption stage' }).toBe(true);
    const old = claim!;
    const checkpointsBefore = (await db.query('SELECT slot_name,artifact_id FROM clipper_checkpoints WHERE job_id=$1 ORDER BY slot_name', [jobId])).rows;
    killOwned(first.child);
    // Advance only this owned lease's deadline instead of waiting 30 seconds.
    await db.query("UPDATE worker_leases SET expires_at=now()-interval '1 second' WHERE id=$1", [old.leaseId]); dispatch();
    expect((await w.post(`/api/worker/jobs/${jobId}/progress`, { data: { ...lease(old), sequence: 999, percent: 99, stage: 'FINALIZING', message: 'late' } })).status()).toBe(409);
    expect((await w.post(`/api/worker/jobs/${jobId}/complete`, { data: { ...lease(old), artifactIds: [] } })).status()).toBe(409);
    await new Promise(r => setTimeout(r, 1200)); dispatch(); next = launch(p.credential, work);
    await expect.poll(async () => (await db.query('SELECT status FROM jobs WHERE id=$1', [jobId])).rows[0].status, { timeout: 90000, message: 'Restarted worker completed the same job' }).toBe('SUCCEEDED');
    const attempts = (await db.query('SELECT id,status,attempt_number FROM job_attempts WHERE job_id=$1 ORDER BY attempt_number', [jobId])).rows;
    expect(attempts.map(a => a.status)).toEqual(['LOST', 'SUCCEEDED']);
    const metrics = JSON.parse(await readFile(resolve(work, jobId, attempts[1].id, 'receipt.json'), 'utf8')).metrics;
    if (['ANALYZING_TRANSCRIPT', 'RENDERING', 'UPLOADING_RESULTS', 'FINALIZING'].includes(stage)) expect(metrics.transcription).toBe(0);
    if (['RENDERING', 'UPLOADING_RESULTS', 'FINALIZING'].includes(stage)) expect(metrics.analyzer).toBe(0);
    if (stage === 'FINALIZING') expect(metrics.render).toBe(0);
    const final = (await db.query('SELECT result,attempt_count,max_attempts FROM jobs WHERE id=$1', [jobId])).rows[0];
    expect(final.attempt_count).toBe(2); expect(final.result.clips).toHaveLength(2); expect(new Set(final.result.artifactIds).size).toBe(4);
    const publications = publishJob(f.workspaceId, jobId, 3); expect(publications.every((ids: string[]) => ids.length === 2 && JSON.stringify(ids) === JSON.stringify(publications[0]))).toBe(true); dispatch();
    const ledger = (await db.query('SELECT entry_type,count(*)::int AS count FROM token_ledger_entries WHERE job_id=$1 GROUP BY entry_type ORDER BY entry_type', [jobId])).rows;
    expect(ledger).toEqual([{ entry_type: 'CAPTURE', count: 1 }, { entry_type: 'RESERVE', count: 1 }]);
    if(f.sharedWorkspaceId){const balances=(await db.query('SELECT a.available_tokens,a.reserved_tokens FROM billing_account_wallets a JOIN workspaces w ON w.billing_account_id=a.billing_account_id WHERE w.id=ANY($1::uuid[])',[[f.workspaceId,f.sharedWorkspaceId]])).rows;expect(balances).toHaveLength(2);for(const balance of balances)expect(balance).toEqual({available_tokens:(BigInt(before)-BigInt(600)).toString(),reserved_tokens:'0'});}
    expect(Number((await db.query('SELECT count(*) FROM content_publications WHERE job_id=$1', [jobId])).rows[0].count)).toBe(1);
    expect(Number((await db.query('SELECT count(*) FROM content_versions WHERE job_id=$1', [jobId])).rows[0].count)).toBe(2);
    const fencing = (await db.query('SELECT fencing_token::text FROM worker_leases WHERE job_id=$1 ORDER BY created_at', [jobId])).rows;
    expect(BigInt(fencing[1].fencing_token)).toBeGreaterThan(BigInt(fencing[0].fencing_token));
    await evidence(`restart-${stage.toLowerCase()}`, { status: 'PASS', command: 'python worker_agent.py', interruptedStage: stage, realWorkerProcesses: true, realStorageTransfers: true, realFfmpegRendering: true, fakeTranscriptionAndAnalyzer: true, oldLeaseLateProgress: 409, oldLeaseLateComplete: 409, attemptStatuses: attempts.map(a => a.status), sharedWallet:!!f.sharedWorkspaceId,sharedTokens:f.sharedWorkspaceId?600:undefined,sharedBalancesMatch:f.sharedWorkspaceId?true:undefined,fencingAdvanced: true, checkpointsBefore: checkpointsBefore.map(c => c.slot_name), restartMetrics: metrics, finalClips: 2, publishedContentVersions: 2, ledger, paidInference: 0 });
  } finally {
    killOwned(first?.child); killOwned(next?.child);
    await writeFile(`${process.env.STABILIZATION_LOG_DIR||'test-data/stabilization-phase-a/restart'}/${stage}.log`, `${first?.output() || ''}\n${next?.output() || ''}`);
    await db.query("UPDATE workers SET status='DISABLED' WHERE id=$1", [p.workerId]); await w.dispose(); await c.dispose(); await db.end();
  }
});

test('lost leases stop at maxAttempts and release tokens once; interrupted child is retryable', async () => {
  const f = await fixtures(), c = await login(f.email), db = await database(), s = await source(c, f.workspaceId), p = provision(`phase-a-bounds-${Date.now()}`), w: APIRequestContext = await worker(p.credential);
  try {
    const r = await submit(c, f.workspaceId, s.id, crypto.randomUUID()); expect(r.status()).toBe(201); const id = (await r.json()).job.id;
    for (let i = 0; i < 3; i++) {
      expect((await w.post('/api/worker/heartbeat',{data:{agentVersion:'phase-a-bounds',pipelineVersion:'clipper-v1',availableSlots:1,activeLeaseIds:[]}})).status()).toBe(200);
      dispatch(); const claim = (await (await w.post('/api/worker/claim', { data: {} })).json()).claim as Claim; expect(claim.jobId).toBe(id);
      await db.query("UPDATE worker_leases SET expires_at=now()-interval '1 second' WHERE id=$1", [claim.leaseId]); dispatch();
      if (i < 2) await new Promise(r => setTimeout(r, 2200));
    }
    for (let i = 0; i < 3; i++) dispatch();
    const j = (await db.query('SELECT status,attempt_count,max_attempts FROM jobs WHERE id=$1', [id])).rows[0]; expect(j).toEqual({ status: 'FAILED', attempt_count: 3, max_attempts: 3 });
    expect(Number((await db.query('SELECT count(*) FROM job_attempts WHERE job_id=$1', [id])).rows[0].count)).toBe(3);
    const ledger = (await db.query('SELECT entry_type,count(*)::int AS count FROM token_ledger_entries WHERE job_id=$1 GROUP BY entry_type ORDER BY entry_type', [id])).rows; expect(ledger).toEqual([{ entry_type: 'RELEASE', count: 1 }, { entry_type: 'RESERVE', count: 1 }]);
    expect((await w.post('/api/worker/heartbeat',{data:{agentVersion:'phase-a-bounds',pipelineVersion:'clipper-v1',availableSlots:1,activeLeaseIds:[]}})).status()).toBe(200);
    expect((await (await w.post('/api/worker/claim', { data: {} })).json()).claim).toBeNull();
    const other = await submit(c, f.workspaceId, s.id, crypto.randomUUID()); const retryId = (await other.json()).job.id; dispatch(); const claim = (await (await w.post('/api/worker/claim', { data: {} })).json()).claim as Claim;
    expect((await w.post(`/api/worker/jobs/${retryId}/fail`, { data: { ...lease(claim), errorCode: 'LOCAL_PROCESS_FAILED', retriable: false, message: 'Synthetic child stopped' } })).status()).toBe(200);
    expect((await db.query('SELECT status FROM jobs WHERE id=$1', [retryId])).rows[0].status).toBe('QUEUED'); await c.post(`/api/workspaces/${f.workspaceId}/jobs/${retryId}/cancel`); dispatch();
    await evidence('restart-bounds', { status: 'PASS', repeatedLostLeases: 3, terminal: j, ledger, noFourthAttempt: true, interruptedChildServerClassifiedRetryable: true, paidInference: 0 });
  } finally { await db.query("UPDATE workers SET status='DISABLED' WHERE id=$1", [p.workerId]); await w.dispose(); await c.dispose(); await db.end(); }
});
