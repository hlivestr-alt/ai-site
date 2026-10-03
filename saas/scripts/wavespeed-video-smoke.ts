import { mkdir, open, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { query, transaction, pool } from "../src/lib/db";
import { dispatchOne, insertJob, type AiVideoInput } from "../src/lib/job-core";
import { processProviderOne, reserveProviderOne } from "../src/lib/provider-core";
import { publishJobContent } from "../src/lib/content-publication";
import { isUuid } from "../src/lib/core";
import { waveSpeedLivePreflight, waveSpeedSmokePayload } from "../src/lib/wavespeed-preflight";

const folder = resolve("data/wavespeed"), statePath = join(folder, "video-smoke.json"), lockPath = join(folder, "video-smoke-submitted.lock");
type Receipt = { templateJobId: string; workspaceId: string; modelId: string; estimatedCostUsd: number; preparedAt: string; status: string; jobId?: string; predictionId?: string | null; artifactId?: string; contentIds?: string[] };
async function save(receipt: Receipt) { await writeFile(statePath + ".partial", JSON.stringify(receipt, null, 2)); await rename(statePath + ".partial", statePath); }
function isolatedTargets() {
  if (!process.env.TEST_DATABASE_URL || !process.env.TEST_OBJECT_STORAGE_BUCKET || process.env.TEST_DATABASE_URL === process.env.DATABASE_URL || process.env.TEST_OBJECT_STORAGE_BUCKET === process.env.OBJECT_STORAGE_BUCKET || !["local", "test"].includes(process.env.APP_ENV || "")) throw new Error("ISOLATED_TEST_TARGETS_REQUIRED");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.OBJECT_STORAGE_BUCKET = process.env.TEST_OBJECT_STORAGE_BUCKET;
  process.env.VIDEO_PROVIDER = "wavespeed";
}
async function collect(receipt: Receipt) {
  const row = (await query<{ status: string; result: { artifactIds?: string[] }; state: string; external_task_id: string | null; submit_count: number }>("SELECT j.status,j.result,e.state,e.external_task_id,e.submit_count FROM jobs j JOIN provider_executions e ON e.workspace_id=j.workspace_id AND e.job_id=j.id WHERE j.workspace_id=$1 AND j.id=$2", [receipt.workspaceId, receipt.jobId])).rows[0];
  if (!row || row.submit_count !== 1) throw new Error("SMOKE_EXECUTION_UNAVAILABLE");
  receipt.status = row.status; receipt.predictionId = row.external_task_id;
  if (row.status === "SUCCEEDED") { receipt.artifactId = row.result.artifactIds?.[0]; receipt.contentIds = await publishJobContent(receipt.workspaceId, receipt.jobId!); }
  await save(receipt);
  console.log(JSON.stringify({ ...receipt, providerState: row.state, submitCount: row.submit_count, actualProviderCostUsd: null, productionAcceptanceVerified: false }));
  return row.status;
}
async function main() {
  const [command, arg] = process.argv.slice(2);
  if (!["prepare", "submit", "poll"].includes(command)) throw new Error("Usage: wavespeed-video-smoke.ts prepare TEMPLATE_JOB_ID | submit --acknowledge-cost | poll");
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
main().catch(() => { console.error(JSON.stringify({ status: "BLOCKED", code: "WAVESPEED_VIDEO_SMOKE_UNAVAILABLE_DO_NOT_REPLAY" })); process.exitCode = 2; }).finally(() => pool().end());
