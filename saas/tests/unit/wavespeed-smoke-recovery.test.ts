import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { DbClient } from "../../src/lib/db";
import type { AiVideoInput } from "../../src/lib/job-core";
import { WaveSpeedVideoProvider } from "../../src/lib/video-providers/wavespeed";
import { ProviderSafeError } from "../../src/lib/video-providers/types";
import { WAVESPEED_VIDEO_MODEL } from "../../src/lib/wavespeed-config";
import { waveSpeedSmokePayload } from "../../src/lib/wavespeed-preflight";
import { recoverWaveSpeedSmokeOutput, waveSpeedRecoveryFetch, WaveSpeedSmokeRecoveryError, WAVESPEED_HOST_FAILURE, WAVESPEED_SMOKE_ACCURACY, WAVESPEED_SMOKE_IDEMPOTENCY, WAVESPEED_RECOVERY_EVENT } from "../../src/lib/wavespeed-smoke-recovery";
import type { WaveSpeedRecoveryIdentity } from "../../src/lib/wavespeed-smoke-recovery";

const key = "recovery-fixture-secret-never-log", output = "https://d2h7xmz5gqybh9.cloudfront.net/video.mp4?Signature=private-fixture";
const savedEnv = { ...process.env };
before(() => { Object.assign(process.env, { WAVESPEED_API_KEY: key }); delete process.env.WAVESPEED_VIDEO_BASE_URL; });
after(() => { process.env = savedEnv; });
const code = (expected: string) => (error: unknown) => error instanceof WaveSpeedSmokeRecoveryError && error.code === expected;

function fixture() {
  const identity: WaveSpeedRecoveryIdentity = { jobId: randomUUID(), workspaceId: randomUUID(), templateJobId: randomUUID(), predictionId: "pred_recovery_fixture", modelId: WAVESPEED_VIDEO_MODEL };
  const input: AiVideoInput = { schemaVersion: 1, kind: "AI_VIDEO", product: { id: randomUUID(), versionId: randomUUID(), ruleVersionId: randomUUID(), versionNumber: 1, ruleVersionNumber: 1, information: {}, rules: {}, assets: [] }, customerPrompt: waveSpeedSmokePayload.prompt, accuracyInstructions: WAVESPEED_SMOKE_ACCURACY, tier: "QUALITY", executionProvider: "WAVESPEED", durationSeconds: 4, aspectRatio: "16:9", quantity: 1, referenceAssetVersionIds: [], providerPolicyVersion: "wavespeed-seedance25-2026-10-03" };
  const row = {
    id: identity.jobId, workspace_id: identity.workspaceId, type: "AI_VIDEO", required_capability: "CLOUD_AI_VIDEO", billing_mode: "DIAGNOSTIC", idempotency_key: WAVESPEED_SMOKE_IDEMPOTENCY,
    input_snapshot: input, input_hash: "original-hash", job_status: "FAILED", error_code: "OUTPUT_INVALID" as string | null, error_message_safe: WAVESPEED_HOST_FAILURE as string | null,
    attempt_count: 1, max_attempts: 1, cancel_requested_at: null as Date | null, execution_count: 1, attempt_rows: 1, has_billing: false,
    execution_id: randomUUID(), attempt_id: randomUUID(), provider: "WAVESPEED", model: WAVESPEED_VIDEO_MODEL, provider_policy_version: input.providerPolicyVersion, state: "FAILED", external_task_id: identity.predictionId,
    submit_count: 1, poll_count: 44, ingest_count: 0, submission_started_at: new Date("2026-10-03T06:32:43.506Z"), submitted_at: new Date("2026-10-03T06:32:43.725Z"),
    provider_error_code: "OUTPUT_INVALID" as string | null, safe_error: WAVESPEED_HOST_FAILURE as string | null, attempt_status: "FAILED", attempt_number: 1, attempt_error_code: "OUTPUT_INVALID" as string | null, attempt_error_message_safe: WAVESPEED_HOST_FAILURE as string | null, recovered_before: false,
  };
  const statements: { sql: string; params: unknown[] }[] = [], requests: { url: string; method: string }[] = [];
  const events: Record<string, unknown>[] = [];
  const db = { query: async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params: structuredClone(params) });
    if (sql.startsWith("SELECT j.id")) return { rows: [structuredClone(row)], rowCount: 1 };
    if (sql.startsWith("UPDATE provider_executions")) { row.state = "OUTPUT_PENDING"; row.provider_error_code = null; row.safe_error = null; }
    else if (sql.startsWith("UPDATE jobs")) { row.job_status = "RUNNING"; row.error_code = null; row.error_message_safe = null; }
    else if (sql.startsWith("UPDATE job_attempts")) { row.attempt_status = "RUNNING"; row.attempt_error_code = null; row.attempt_error_message_safe = null; }
    else if (sql.startsWith("INSERT INTO job_events")) { assert.equal(params[4], WAVESPEED_RECOVERY_EVENT); const event = JSON.parse(String(params[5])); events.push(event); if (event.reason === "OUTPUT_HOST_POLICY_CORRECTION") row.recovered_before = true; }
    else assert.fail("Unexpected database mutation");
    return { rows: [], rowCount: 1 };
  } } as unknown as DbClient;
  const transaction = async <T>(work: (client: DbClient) => Promise<T>) => { const previous = structuredClone(row); try { return await work(db); } catch (error) { Object.assign(row, previous); throw error; } };
  let answer: unknown = { id: identity.predictionId, status: "completed", outputs: [output] }, status = 200, fetchError: Error | null = null;
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method || "GET" });
    assert.equal(String(url), `https://api.wavespeed.ai/api/v3/predictions/${identity.predictionId}/result`);
    assert.equal(init?.method || "GET", "GET"); assert.equal(init?.redirect, "manual"); assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${key}`);
    if (fetchError) throw fetchError;
    return Response.json({ code: status, data: answer }, { status });
  };
  const readOnly = waveSpeedRecoveryFetch(identity.predictionId, fetcher), provider = new WaveSpeedVideoProvider({ fetch: readOnly.fetch });
  return { identity, row, db, transaction, provider, statements, requests, events, readOnly, answer: (value: unknown) => { answer = value; }, status: (value: number) => { status = value; }, fetchError: (value: Error) => { fetchError = value; } };
}
const mutations = (f: ReturnType<typeof fixture>) => f.statements.filter(s => !s.sql.startsWith("SELECT"));
const recover = (f: ReturnType<typeof fixture>) => recoverWaveSpeedSmokeOutput(f.identity, f);
function noLeaks(f: ReturnType<typeof fixture>) { const stored = JSON.stringify({ mutations: mutations(f), row: f.row, events: f.events }); assert.ok(!stored.includes(key)); assert.ok(!stored.includes(output)); assert.ok(!stored.includes("Signature=")); }

test("recovery authenticates only the persisted prediction GET and reopens the original records with an audit event", async () => {
  const f = fixture(), original = structuredClone(f.row);
  const result = await recover(f);
  assert.deepEqual(result, { jobId: original.id, executionId: original.execution_id, attemptId: original.attempt_id, predictionId: original.external_task_id, state: "OUTPUT_PENDING", reopened: true });
  assert.equal(f.row.state, "OUTPUT_PENDING"); assert.equal(f.row.job_status, "RUNNING"); assert.equal(f.row.attempt_status, "RUNNING");
  for (const field of ["id", "attempt_id", "execution_id", "external_task_id", "submit_count", "submission_started_at", "submitted_at", "input_snapshot", "input_hash", "idempotency_key", "poll_count", "ingest_count"] as const) assert.deepEqual(f.row[field], original[field]);
  assert.equal(f.events.length, 1); assert.equal(f.events[0].recoveryMode, "OUTPUT_INGEST_ONLY");
  assert.equal(f.readOnly.counts.predictionGets, 1); assert.equal(f.readOnly.counts.waveSpeedPosts, 0);
  assert.equal(mutations(f).length, 4); assert.ok(mutations(f).every(s => !/INSERT INTO (jobs|job_attempts|provider_executions)/.test(s.sql)));
  noLeaks(f);
  const again = await recover(f); assert.equal(again.reopened, false); assert.equal(mutations(f).length, 4); assert.equal(f.events.length, 1);
  f.row.state = f.row.job_status = f.row.attempt_status = "SUCCEEDED";
  const gets = f.requests.length; assert.equal((await recover(f)).state, "SUCCEEDED"); assert.equal(f.requests.length, gets); assert.equal(mutations(f).length, 4);
});

test("recovery refuses receipt mismatch, additional submissions/executions/attempts and missing submission identity before GET", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.identity.predictionId = "another_prediction"; },
    (f: ReturnType<typeof fixture>) => { f.row.submit_count = 2; },
    (f: ReturnType<typeof fixture>) => { f.row.execution_count = 2; },
    (f: ReturnType<typeof fixture>) => { f.row.attempt_rows = 2; },
    (f: ReturnType<typeof fixture>) => { f.row.workspace_id = randomUUID(); },
  ]) { const f = fixture(); change(f); await assert.rejects(recover(f), code("SMOKE_EXECUTION_IDENTITY_MISMATCH")); assert.equal(f.requests.length, 0); assert.equal(mutations(f).length, 0); }
  for (const jobId of ["", "not-a-uuid"]) { const f = fixture(); f.identity.jobId = jobId; await assert.rejects(recover(f), code("SMOKE_RECEIPT_IDENTITY_REQUIRED")); assert.equal(f.statements.length, 0); }
  const f = fixture(); f.identity.predictionId = "../inject/path"; await assert.rejects(recover(f), code("SMOKE_RECEIPT_IDENTITY_REQUIRED")); assert.equal(f.statements.length, 0);
});

test("only the fixed WaveSpeed diagnostic smoke is eligible; normal customer, other provider, cancelled and changed payload jobs are refused", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.row.provider = "BYTEPLUS"; },
    (f: ReturnType<typeof fixture>) => { f.row.billing_mode = "PAID"; },
    (f: ReturnType<typeof fixture>) => { f.row.has_billing = true; },
    (f: ReturnType<typeof fixture>) => { f.row.idempotency_key = "customer-video"; },
    (f: ReturnType<typeof fixture>) => { f.row.input_snapshot.customerPrompt = "Unrelated video"; },
    (f: ReturnType<typeof fixture>) => { f.row.input_snapshot.referenceAssetVersionIds = [randomUUID()]; },
    (f: ReturnType<typeof fixture>) => { f.row.cancel_requested_at = new Date(); },
    (f: ReturnType<typeof fixture>) => { f.row.attempt_number = 2; },
  ]) { const f = fixture(); change(f); await assert.rejects(recover(f), code("DIAGNOSTIC_WAVESPEED_SMOKE_REQUIRED")); assert.equal(f.requests.length, 0); assert.equal(mutations(f).length, 0); }
});

test("unrelated failures, generic output validation errors and unaudited pending recovery are refused", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.row.error_code = "PROVIDER_FAILED"; },
    (f: ReturnType<typeof fixture>) => { f.row.safe_error = "The provider output is not an MP4 file."; },
    (f: ReturnType<typeof fixture>) => { f.row.error_code = f.row.provider_error_code = f.row.attempt_error_code = "OUTPUT_UNAVAILABLE"; },
    (f: ReturnType<typeof fixture>) => { f.row.job_status = f.row.attempt_status = "RUNNING"; f.row.state = "OUTPUT_PENDING"; },
  ]) { const f = fixture(); change(f); await assert.rejects(recover(f), code("SMOKE_OUTPUT_HOST_FAILURE_REQUIRED")); assert.equal(mutations(f).length, 0); assert.equal(f.requests.length, 0); }
});

test("incomplete, mismatched, malformed, multiple and unapproved prediction outputs never mutate the failed records", async () => {
  for (const status of ["queued", "processing", "failed"]) { const f = fixture(); f.answer({ id: f.identity.predictionId, status, outputs: [output] }); await assert.rejects(recover(f), code("SMOKE_PREDICTION_NOT_COMPLETED")); assert.equal(mutations(f).length, 0); }
  for (const answer of [null, {}, { id: "wrong_prediction", status: "completed", outputs: [output] }, { id: "pred_recovery_fixture", status: "completed", outputs: [] }, { id: "pred_recovery_fixture", status: "completed", outputs: [output, output] }, { id: "pred_recovery_fixture", status: "completed", outputs: ["https://random123.cloudfront.net/video.mp4"] }]) { const f = fixture(); f.answer(answer); await assert.rejects(recover(f), ProviderSafeError); assert.equal(mutations(f).length, 0); assert.equal(f.row.state, "FAILED"); noLeaks(f); }
});

test("provider errors and secrets are sanitized and never logged or persisted", async () => {
  const messages: unknown[] = [], log = console.log, error = console.error;
  console.log = (...args) => { messages.push(args); }; console.error = (...args) => { messages.push(args); };
  try {
    for (const status of [401, 403, 429, 503]) { const f = fixture(); f.status(status); await assert.rejects(recover(f), (error: unknown) => error instanceof ProviderSafeError && !error.message.includes(key) && !error.message.includes(output)); assert.equal(mutations(f).length, 0); noLeaks(f); }
    const f = fixture(); f.fetchError(new Error(`${key} ${output}`)); await assert.rejects(recover(f), (error: unknown) => error instanceof ProviderSafeError && !error.message.includes(key) && !error.message.includes(output)); noLeaks(f);
    assert.deepEqual(messages, []);
  } finally { console.log = log; console.error = error; }
});

test("identity and immutable hash are checked again under lock after the provider GET", async () => {
  const f = fixture(), originalPoll = f.provider.poll.bind(f.provider);
  f.provider.poll = async id => { const result = await originalPoll(id); f.row.input_hash = "changed-during-get"; return result; };
  await assert.rejects(recover(f), code("SMOKE_RECOVERY_STATE_CHANGED")); assert.equal(mutations(f).length, 0);
});

test("transient exhaustion can retry the same output only with proof of the original host recovery", async () => {
  const f = fixture(); await recover(f);
  f.row.job_status = f.row.attempt_status = f.row.state = "FAILED"; f.row.ingest_count = 6;
  f.row.error_code = f.row.provider_error_code = f.row.attempt_error_code = "OUTPUT_UNAVAILABLE";
  f.row.error_message_safe = f.row.safe_error = f.row.attempt_error_message_safe = "The video result could not be stored after retries.";
  f.row.recovered_before = false; await assert.rejects(recover(f), code("SMOKE_OUTPUT_HOST_FAILURE_REQUIRED"));
  f.row.recovered_before = true; assert.equal((await recover(f)).reopened, true);
  assert.equal(f.row.submit_count, 1); assert.equal(f.row.ingest_count, 6); assert.equal(f.events.at(-1)?.reason, "RETRY_EXISTING_OUTPUT_INGEST"); noLeaks(f);
});

test("the recovery fetch guard blocks all POSTs, other prediction IDs, account endpoints, LLM inference and redirects before network", async () => {
  let forwarded = 0;
  const guarded = waveSpeedRecoveryFetch("pred_fixture", (async () => { forwarded++; return new Response(); }) as typeof fetch);
  for (const [url, init] of [
    ["https://api.wavespeed.ai/api/v3/bytedance/seedance-2.5/text-to-video", { method: "POST", redirect: "manual" }],
    ["https://api.wavespeed.ai/api/v3/predictions/other_prediction/result", { redirect: "manual", headers: { Authorization: `Bearer ${key}` } }],
    ["https://api.wavespeed.ai/api/v3/balance", { redirect: "manual" }],
    ["https://llm.wavespeed.ai/v1/chat/completions", { method: "POST", redirect: "manual" }],
    ["https://api.wavespeed.ai/api/v3/predictions/pred_fixture/result", { redirect: "follow" }],
    ["https://random123.cloudfront.net/video.mp4", { redirect: "manual" }],
    [output, { redirect: "manual", headers: { Authorization: `Bearer ${key}` } }],
  ] as [string, RequestInit][]) await assert.rejects(guarded.fetch(url, init), code("SMOKE_RECOVERY_GET_ONLY"));
  await assert.rejects(guarded.fetch(new Request(output, { redirect: "manual", headers: { Authorization: `Bearer ${key}` } })), code("SMOKE_RECOVERY_GET_ONLY"));
  assert.equal(forwarded, 0); assert.equal(guarded.counts.waveSpeedPosts, 0); assert.equal(guarded.counts.blockedRequests, 8);
  await guarded.fetch("https://api.wavespeed.ai/api/v3/predictions/pred_fixture/result", { redirect: "manual", headers: { Authorization: `Bearer ${key}` } });
  await guarded.fetch(output, { redirect: "manual" }); assert.equal(forwarded, 2);
});
