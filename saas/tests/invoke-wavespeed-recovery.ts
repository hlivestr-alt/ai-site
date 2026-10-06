import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { query, transaction, pool } from "../src/lib/db";
import { insertJob, dispatchOne, type AiVideoInput } from "../src/lib/job-core";
import { processProviderOutputOne, reserveProviderOne } from "../src/lib/provider-core";
import { publishJobContent } from "../src/lib/content-publication";
import { objectStorage } from "../src/lib/storage";
import { WAVESPEED_VIDEO_MODEL } from "../src/lib/wavespeed-config";
import { waveSpeedSmokePayload } from "../src/lib/wavespeed-preflight";
import { recoverWaveSpeedSmokeOutput, waveSpeedRecoveryFetch, WAVESPEED_HOST_FAILURE, WAVESPEED_SMOKE_ACCURACY, WAVESPEED_SMOKE_IDEMPOTENCY, WAVESPEED_RECOVERY_EVENT } from "../src/lib/wavespeed-smoke-recovery";

const [workspaceId, templateId, mode] = process.argv.slice(2);
const key = "wavespeed-recovery-integration-fixture-not-real";
const output = "https://d2h7xmz5gqybh9.cloudfront.net/output/fixture.mp4?Signature=private-fixture";
let polls = 0, downloads = 0, posts = 0;
type Snapshot = { jobId: string; workspaceId: string; input: AiVideoInput; inputHash: string; idempotencyKey: string; jobStatus: string; executionId: string; attemptId: string; predictionId: string; state: string; submitCount: number; pollCount: number; ingestCount: number; submissionStartedAt: string; submittedAt: string; attemptStatus: string; jobs: number; executions: number; attempts: number };
async function snapshot(id: string) {
  return (await query<Snapshot>(`SELECT j.id AS "jobId",j.workspace_id AS "workspaceId",j.input_snapshot AS input,j.input_hash AS "inputHash",j.idempotency_key AS "idempotencyKey",j.status AS "jobStatus",
    e.id AS "executionId",e.attempt_id AS "attemptId",e.external_task_id AS "predictionId",e.state,e.submit_count AS "submitCount",e.poll_count AS "pollCount",e.ingest_count AS "ingestCount",e.submission_started_at::text AS "submissionStartedAt",e.submitted_at::text AS "submittedAt",a.status AS "attemptStatus",
    (SELECT count(*)::int FROM jobs WHERE workspace_id=j.workspace_id) AS jobs,
    (SELECT count(*)::int FROM provider_executions WHERE workspace_id=j.workspace_id) AS executions,
    (SELECT count(*)::int FROM job_attempts WHERE workspace_id=j.workspace_id) AS attempts
    FROM jobs j JOIN provider_executions e ON e.workspace_id=j.workspace_id AND e.job_id=j.id JOIN job_attempts a ON a.id=e.attempt_id WHERE j.workspace_id=$1 AND j.id=$2`, [workspaceId, id])).rows[0];
}
async function main() {
  if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL || process.env.OBJECT_STORAGE_BUCKET !== process.env.TEST_OBJECT_STORAGE_BUCKET || !["success", "transient"].includes(mode)) throw new Error("ISOLATED_TARGETS_REQUIRED");
  Object.assign(process.env, { VIDEO_PROVIDER: "wavespeed", WAVESPEED_API_KEY: key, PROVIDER_MAX_CONCURRENCY: "100", PROVIDER_WORKSPACE_CONCURRENCY: "100" });
  delete process.env.WAVESPEED_VIDEO_BASE_URL; delete process.env.WAVESPEED_SEEDANCE_MODEL;
  const template = (await query<{ input_snapshot: AiVideoInput; created_by: string }>("SELECT input_snapshot,created_by FROM jobs WHERE workspace_id=$1 AND id=$2 AND status='CANCELLED' AND input_snapshot->>'executionProvider'='FAKE'", [workspaceId, templateId])).rows[0];
  assert.ok(template);
  const input: AiVideoInput = { ...template.input_snapshot, executionProvider: "WAVESPEED", providerPolicyVersion: "wavespeed-seedance25-2026-10-03", customerPrompt: waveSpeedSmokePayload.prompt, accuracyInstructions: WAVESPEED_SMOKE_ACCURACY, durationSeconds: 4, aspectRatio: "16:9", quantity: 1, referenceAssetVersionIds: [] };
  delete input.testScenario;
  const created = await transaction(db => insertJob(db, { workspaceId, createdBy: template.created_by, type: "AI_VIDEO", capability: "CLOUD_AI_VIDEO", input, idempotencyKey: WAVESPEED_SMOKE_IDEMPOTENCY, maxAttempts: 1, billingMode: "DIAGNOSTIC" }));
  assert.equal(created.existing, false);
  const id = created.id, predictionId = "pred_" + id.replaceAll("-", ""), bytes = await readFile("tests/fixtures/clipper-output.mp4");
  const identity = { jobId: id, workspaceId, templateJobId: templateId, predictionId, modelId: WAVESPEED_VIDEO_MODEL };
  const guarded = waveSpeedRecoveryFetch(predictionId, async (url, init) => {
    if ((init?.method || "GET") === "POST") { posts++; assert.fail("Recovery tried to POST"); }
    if (String(url) === `https://api.wavespeed.ai/api/v3/predictions/${predictionId}/result`) {
      polls++; assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${key}`);
      return Response.json({ code: 200, data: { id: predictionId, status: "completed", outputs: [output], error: "" } });
    }
    assert.equal(String(url), output); downloads++;
    if (mode === "transient" && downloads <= 6) throw new Error(`${key} ${output}`);
    return new Response(bytes, { headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.length) } });
  });
  globalThis.fetch = guarded.fetch; // No real provider request is possible, including fixture setup.
  await dispatchOne(id); assert.equal(await reserveProviderOne(id), true);
  assert.equal(await processProviderOutputOne(id), false); // RESERVED cannot dispatch a submission.
  const reserved = await snapshot(id); assert.equal(reserved.submitCount, 0); assert.equal(polls, 0);
  // Database fixture for a previously paid, completed generation. No POST is
  // used to obtain it, and the real operator receipt/guard are never accessed.
  await transaction(async db => {
    await db.query("UPDATE provider_executions SET state='FAILED',external_task_id=$1,submit_count=1,poll_count=44,submission_started_at='2026-10-03T06:32:43.506Z',submitted_at='2026-10-03T06:32:43.725Z',completed_at=now(),provider_error_code='OUTPUT_INVALID',safe_error=$2 WHERE workspace_id=$3 AND job_id=$4", [predictionId, WAVESPEED_HOST_FAILURE, workspaceId, id]);
    await db.query("UPDATE job_attempts SET status='FAILED',error_code='OUTPUT_INVALID',error_message_safe=$1,finished_at=now() WHERE workspace_id=$2 AND job_id=$3", [WAVESPEED_HOST_FAILURE, workspaceId, id]);
    await db.query("UPDATE jobs SET status='FAILED',error_code='OUTPUT_INVALID',error_message_safe=$1,finished_at=now() WHERE workspace_id=$2 AND id=$3", [WAVESPEED_HOST_FAILURE, workspaceId, id]);
  });
  const before = await snapshot(id);
  assert.equal((await recoverWaveSpeedSmokeOutput(identity)).reopened, true);
  if (mode === "transient") {
    for (let attempt = 1; attempt <= 6; attempt++) {
      assert.equal(await processProviderOutputOne(id), true);
      const failedDownload = await snapshot(id); assert.equal(failedDownload.submitCount, 1); assert.equal(failedDownload.predictionId, predictionId);
      if (attempt < 6) {
        assert.equal(failedDownload.state, "OUTPUT_PENDING");
        const gets: number = polls; assert.equal((await recoverWaveSpeedSmokeOutput(identity)).reopened, false); assert.equal(polls, gets + 1);
        assert.equal(await processProviderOutputOne(id), false); // Recovery preserves backoff.
        await query("UPDATE provider_executions SET next_action_at=now() WHERE workspace_id=$1 AND job_id=$2", [workspaceId, id]);
      } else assert.equal(failedDownload.state, "FAILED");
    }
    assert.equal((await recoverWaveSpeedSmokeOutput(identity)).reopened, true); // Explicit retry, same audited prediction.
  }
  assert.equal(await processProviderOutputOne(id), true);
  const contentIds = await publishJobContent(workspaceId, id), after = await snapshot(id);
  assert.equal(after.jobStatus, "SUCCEEDED"); assert.equal(after.state, "SUCCEEDED"); assert.equal(after.attemptStatus, "SUCCEEDED");
  for (const field of ["jobId", "workspaceId", "input", "inputHash", "idempotencyKey", "executionId", "attemptId", "predictionId", "submitCount", "pollCount", "submissionStartedAt", "submittedAt", "jobs", "executions", "attempts"] as const) assert.deepEqual(after[field], before[field]);
  const artifacts = (await query<{ id: string; status: string; storage_key: string; sha256: string; byte_size: string; duration_seconds: string; width: number; height: number }>("SELECT id,status,storage_key,sha256,byte_size,duration_seconds,width,height FROM job_artifacts WHERE workspace_id=$1 AND job_id=$2", [workspaceId, id])).rows;
  assert.equal(artifacts.length, 1); assert.equal(artifacts[0].status, "READY"); assert.equal(contentIds.length, 1);
  const artifact = artifacts[0], head = await objectStorage().head(artifact.storage_key);
  assert.equal(head?.byteSize, bytes.length); assert.equal(head.contentType, "video/mp4");
  const hash = createHash("sha256"); for await (const chunk of await objectStorage().stream(artifact.storage_key)) hash.update(chunk);
  assert.equal(hash.digest("hex"), artifact.sha256); assert.equal(artifact.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.ok(Number(artifact.duration_seconds) > 0 && artifact.width > 0 && artifact.height > 0);
  const gets: number = polls, downloadCount: number = downloads;
  assert.equal((await recoverWaveSpeedSmokeOutput(identity)).reopened, false);
  assert.equal(await processProviderOutputOne(id), false);
  assert.deepEqual(await publishJobContent(workspaceId, id), contentIds);
  assert.equal(polls, gets); assert.equal(downloads, downloadCount); assert.deepEqual(await snapshot(id), after);
  const events = (await query<{ event_type: string; safe_data: Record<string, unknown> }>("SELECT event_type,safe_data FROM job_events WHERE workspace_id=$1 AND job_id=$2 AND event_type=$3", [workspaceId, id, WAVESPEED_RECOVERY_EVENT])).rows;
  assert.equal(events.length, mode === "transient" ? 2 : 1);
  const persisted = (await query<{ document: string }>("SELECT to_jsonb(j)::text AS document FROM jobs j WHERE id=$1 UNION ALL SELECT to_jsonb(e)::text FROM provider_executions e WHERE job_id=$1 UNION ALL SELECT to_jsonb(a)::text FROM job_artifacts a WHERE job_id=$1 UNION ALL SELECT to_jsonb(e)::text FROM job_events e WHERE job_id=$1 UNION ALL SELECT to_jsonb(c)::text FROM content_items c WHERE origin_job_id=$1", [id])).rows;
  assert.ok(persisted.every(r => !r.document.includes(key) && !r.document.includes(output) && !r.document.includes("Signature=")));
  assert.equal(posts, 0); assert.equal(guarded.counts.waveSpeedPosts, 0); assert.equal(guarded.counts.blockedRequests, 0);
  console.log(JSON.stringify({ id, before, after, artifacts: artifacts.map(({ storage_key, ...rest }) => { void storage_key; return rest; }), contentIds, events, polls, downloads, posts, privateStorageVerified: true }));
}
main().catch(() => { console.error(JSON.stringify({ code: "WAVESPEED_RECOVERY_INTEGRATION_FAILED" })); process.exitCode = 1; }).finally(() => pool().end());
