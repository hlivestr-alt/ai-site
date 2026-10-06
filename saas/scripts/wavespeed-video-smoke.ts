import { mkdir, open, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { query, transaction, pool } from "../src/lib/db";
import { dispatchOne, insertJob, type AiVideoInput } from "../src/lib/job-core";
import { processProviderOne, processProviderOutputOne, reserveProviderOne } from "../src/lib/provider-core";
import { publishJobContent } from "../src/lib/content-publication";
import { isUuid } from "../src/lib/core";
import { waveSpeedLivePreflight, waveSpeedSmokePayload } from "../src/lib/wavespeed-preflight";
import { objectStorage } from "../src/lib/storage";
import { recoverWaveSpeedSmokeOutput, WaveSpeedSmokeRecoveryError, waveSpeedRecoveryFetch } from "../src/lib/wavespeed-smoke-recovery";

const folder = resolve("data/wavespeed"), statePath = join(folder, "video-smoke.json"), lockPath = join(folder, "video-smoke-submitted.lock");
type Receipt = { templateJobId: string; workspaceId: string; modelId: string; estimatedCostUsd: number; preparedAt: string; status: string; jobId?: string; predictionId?: string | null; artifactId?: string; contentIds?: string[] };
async function save(receipt: Receipt) { await writeFile(statePath + ".partial", JSON.stringify(receipt, null, 2)); await rename(statePath + ".partial", statePath); }
function isolatedTargets() {
  if (!process.env.TEST_DATABASE_URL || !process.env.TEST_OBJECT_STORAGE_BUCKET || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL || process.env.TEST_OBJECT_STORAGE_BUCKET === process.env.OBJECT_STORAGE_BUCKET || !["local", "test"].includes(process.env.APP_ENV || "")) throw new Error("ISOLATED_TEST_TARGETS_REQUIRED");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.OBJECT_STORAGE_BUCKET = process.env.TEST_OBJECT_STORAGE_BUCKET;
  process.env.VIDEO_PROVIDER = "wavespeed";
}
async function collect(receipt: Receipt, recovery?: Record<string, unknown>) {
  const row = (await query<{ status: string; result: { artifactIds?: string[]; durationSeconds?: number; width?: number; height?: number } | null; state: string; execution_id: string; attempt_id: string; external_task_id: string | null; submit_count: number; poll_count: number; ingest_count: number }>("SELECT j.status,j.result,e.state,e.id AS execution_id,e.attempt_id,e.external_task_id,e.submit_count,e.poll_count,e.ingest_count FROM jobs j JOIN provider_executions e ON e.workspace_id=j.workspace_id AND e.job_id=j.id WHERE j.workspace_id=$1 AND j.id=$2", [receipt.workspaceId, receipt.jobId])).rows[0];
  if (!row || row.submit_count !== 1 || receipt.predictionId && receipt.predictionId !== row.external_task_id) throw new Error("SMOKE_EXECUTION_UNAVAILABLE");
  receipt.status = row.status; receipt.predictionId = row.external_task_id;
  let privateStorageVerified: boolean | null = null;
  if (row.status === "SUCCEEDED") {
    receipt.artifactId = row.result?.artifactIds?.[0]; receipt.contentIds = await publishJobContent(receipt.workspaceId, receipt.jobId!);
    const artifact = (await query<{ status: string; storage_key: string; byte_size: string; mime_type: string; verified_at: Date | null }>("SELECT status,storage_key,byte_size,mime_type,verified_at FROM job_artifacts WHERE workspace_id=$1 AND job_id=$2 AND attempt_id=$3 AND id=$4", [receipt.workspaceId, receipt.jobId, row.attempt_id, receipt.artifactId])).rows[0];
    const head = artifact ? await objectStorage().head(artifact.storage_key) : null;
    privateStorageVerified = !!artifact && artifact.status === "READY" && !!artifact.verified_at && artifact.storage_key.startsWith(`workspaces/${receipt.workspaceId}/jobs/${receipt.jobId}/outputs/`) && artifact.mime_type === "video/mp4" && head?.byteSize === Number(artifact.byte_size) && head?.contentType === "video/mp4";
    if (!privateStorageVerified) throw new Error("SMOKE_PRIVATE_OUTPUT_UNVERIFIED");
  }
  await save(receipt);
  console.log(JSON.stringify({ ...receipt, providerState: row.state, executionId: row.execution_id, attemptId: row.attempt_id, submitCount: row.submit_count, pollCount: row.poll_count, ingestCount: row.ingest_count, durationSeconds: row.result?.durationSeconds, width: row.result?.width, height: row.result?.height, privateStorageVerified, recovery, actualProviderCostUsd: null, productionAcceptanceVerified: false }));
  return row.status;
}
async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!["prepare", "submit", "poll", "recover-output"].includes(command)) throw new Error("Usage: wavespeed-video-smoke.ts prepare TEMPLATE_JOB_ID | submit --acknowledge-cost | poll | recover-output --acknowledge-existing-prediction");
  isolatedTargets();
  await mkdir(folder, { recursive: true });
  if (command === "prepare") {
    if (!isUuid(arg)) throw new Error("CANCELLED_TEST_TEMPLATE_JOB_REQUIRED");
    const preflight = await waveSpeedLivePreflight();
    if (!preflight.ready) { console.log(JSON.stringify({ status: "BLOCKED", preflight })); process.exitCode = 2; return; }
    const template = (await query<{ workspace_id: string }>("SELECT workspace_id FROM jobs WHERE id=$1 AND type='AI_VIDEO' AND input_snapshot->>'executionProvider'='FAKE' AND status='CANCELLED'", [arg])).rows[0];
    if (!template) throw new Error("CANCELLED_TEST_TEMPLATE_JOB_REQUIRED");
    const receipt: Receipt = { templateJobId: arg, workspaceId: template.workspace_id, modelId: preflight.videoModel.modelId!, estimatedCostUsd: preflight.videoEstimate.amountUsd!, preparedAt: new Date().toISOString(), status: "PREPARED" };
    const state = await open(statePath, "wx"); try { await state.writeFile(JSON.stringify(receipt, null, 2)); } finally { await state.close(); }
    console.log(JSON.stringify({ ...receipt, payload: waveSpeedSmokePayload, nextCommand: "npm run wavespeed:video-smoke -- submit --acknowledge-cost", paidRequests: 0 })); return;
  }
  const receipt = JSON.parse(await readFile(statePath, "utf8")) as Receipt;
  if (!isUuid(receipt.templateJobId) || !isUuid(receipt.workspaceId)) throw new Error("INVALID_SMOKE_RECEIPT");
  if (command === "recover-output") {
    if (arg !== "--acknowledge-existing-prediction" || process.argv.slice(2).length !== 2 || !receipt.jobId || !isUuid(receipt.jobId) || !receipt.predictionId) throw new WaveSpeedSmokeRecoveryError("SMOKE_RECEIPT_IDENTITY_REQUIRED");
    const guardBytes = await readFile(lockPath), guard = JSON.parse(guardBytes.toString("utf8")) as { templateJobId?: string; startedAt?: string };
    if (guard.templateJobId !== receipt.templateJobId || !guard.startedAt || !Number.isFinite(Date.parse(guard.startedAt))) throw new WaveSpeedSmokeRecoveryError("SMOKE_RECEIPT_IDENTITY_REQUIRED");
    const originalFetch = globalThis.fetch, readOnly = waveSpeedRecoveryFetch(receipt.predictionId, originalFetch);
    globalThis.fetch = readOnly.fetch;
    try {
      const recovery = await recoverWaveSpeedSmokeOutput({ jobId: receipt.jobId, workspaceId: receipt.workspaceId, predictionId: receipt.predictionId, templateJobId: receipt.templateJobId, modelId: receipt.modelId });
      await processProviderOutputOne(receipt.jobId); // Existing normal ingest, with no submission dispatch branch.
      if (!(await readFile(lockPath)).equals(guardBytes)) throw new Error("SMOKE_SUBMISSION_GUARD_CHANGED");
      const status = await collect(receipt, { ...readOnly.counts, reopened: recovery.reopened, additionalPaidGenerations: 0 });
      if (status !== "SUCCEEDED") process.exitCode = 2; // Same receipt can resume; persisted retry backoff remains intact.
    } finally { globalThis.fetch = originalFetch; }
    return;
  }
  if (command === "submit") {
    if (arg !== "--acknowledge-cost" || receipt.status !== "PREPARED" || receipt.jobId) throw new Error("PREPARED_RECEIPT_AND_COST_ACKNOWLEDGEMENT_REQUIRED");
    const preflight = await waveSpeedLivePreflight();
    if (!preflight.ready || preflight.videoModel.modelId !== receipt.modelId || preflight.videoEstimate.amountUsd! > receipt.estimatedCostUsd || Date.now() - Date.parse(receipt.preparedAt) > 3600000) { console.log(JSON.stringify({ status: "BLOCKED", code: "PREFLIGHT_OR_PRICE_CHANGED", preflight })); process.exitCode = 2; return; }
    const template = (await query<{ input_snapshot: AiVideoInput; created_by: string }>("SELECT input_snapshot,created_by FROM jobs WHERE workspace_id=$1 AND id=$2 AND status='CANCELLED'", [receipt.workspaceId, receipt.templateJobId])).rows[0];
    if (!template) throw new Error("CANCELLED_TEST_TEMPLATE_JOB_REQUIRED");
    // Durable exclusive guard is retained even on failure/crash. Do not delete it
    // to rerun. An ambiguous response may have been accepted and billed.
    const guard = await open(lockPath, "wx"); try { await guard.writeFile(JSON.stringify({ templateJobId: receipt.templateJobId, startedAt: new Date().toISOString() })); } finally { await guard.close(); }
    receipt.status = "SUBMITTING"; await save(receipt);
    const input: AiVideoInput = { ...template.input_snapshot, executionProvider: "WAVESPEED", providerPolicyVersion: "wavespeed-seedance25-2026-10-03", customerPrompt: waveSpeedSmokePayload.prompt, accuracyInstructions: "Connectivity test only; make no Product claims.", durationSeconds: 4, aspectRatio: "16:9", quantity: 1, referenceAssetVersionIds: [] };
    delete input.testScenario;
    const created = await transaction(db => insertJob(db, { workspaceId: receipt.workspaceId, createdBy: template.created_by, type: "AI_VIDEO", capability: "CLOUD_AI_VIDEO", input, idempotencyKey: "wavespeed-live-connectivity-smoke-v1", maxAttempts: 1, billingMode: "DIAGNOSTIC" }));
    receipt.jobId = created.id; await save(receipt);
    if (created.existing) throw new Error("SMOKE_ALREADY_SUBMITTED_DO_NOT_REPLAY");
    await dispatchOne(created.id);
    if (!await reserveProviderOne(created.id)) throw new Error("SMOKE_RESERVATION_UNAVAILABLE_DO_NOT_REPLAY");
    await processProviderOne(created.id); // One and only one possible inference POST.
    await collect(receipt); return;
  }
  if (!receipt.jobId || !isUuid(receipt.jobId)) throw new Error("SMOKE_JOB_ID_UNAVAILABLE_DO_NOT_REPLAY");
  const started = Date.now();
  while (Date.now() - started < 30 * 60 * 1000) {
    const current = (await query<{ state: string }>("SELECT state FROM provider_executions WHERE workspace_id=$1 AND job_id=$2", [receipt.workspaceId, receipt.jobId])).rows[0];
    if (!current || ["RESERVED", "SUBMITTING"].includes(current.state)) { console.log(JSON.stringify({ status: "BLOCKED", code: "UNKNOWN_SUBMISSION_REQUIRES_OPERATOR_RECONCILIATION" })); process.exitCode = 2; return; }
    if (current.state === "SUBMISSION_UNKNOWN") { await collect(receipt); process.exitCode = 2; return; }
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(current.state)) { const status = await collect(receipt); if (status !== "SUCCEEDED") process.exitCode = 2; return; }
    await processProviderOne(receipt.jobId); // Poll/ingest only. Honors persisted backoff.
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  await collect(receipt); process.exitCode = 2;
}
main().catch(error => { console.error(JSON.stringify({ status: "BLOCKED", code: error instanceof WaveSpeedSmokeRecoveryError ? error.code : "WAVESPEED_VIDEO_SMOKE_UNAVAILABLE_DO_NOT_REPLAY" })); process.exitCode = 2; }).finally(() => pool().end());
