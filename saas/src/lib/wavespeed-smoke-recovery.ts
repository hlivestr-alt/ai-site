import { query, transaction, type DbClient } from "./db";
import { isUuid } from "./core";
import { jobEvent, type AiVideoInput } from "./job-core";
import { WaveSpeedVideoProvider, waveSpeedOutputUrl } from "./video-providers/wavespeed";
import { WAVESPEED_VIDEO_MODEL } from "./wavespeed-config";
import { waveSpeedSmokePayload } from "./wavespeed-preflight";

export const WAVESPEED_SMOKE_IDEMPOTENCY = "wavespeed-live-connectivity-smoke-v1";
export const WAVESPEED_SMOKE_ACCURACY = "Connectivity test only; make no Product claims.";
export const WAVESPEED_HOST_FAILURE = "The provider output host was invalid.";
const INGEST_RETRY_FAILURE = "The video result could not be stored after retries.";
export const WAVESPEED_RECOVERY_EVENT = "PROVIDER_OUTPUT_RECOVERY_STARTED";
export type WaveSpeedRecoveryIdentity = { jobId: string; workspaceId: string; predictionId: string; templateJobId: string; modelId: string };
export type WaveSpeedRecoveryResult = { jobId: string; executionId: string; attemptId: string; predictionId: string; state: "OUTPUT_PENDING" | "SUCCEEDED"; reopened: boolean };
type RecoveryCode = "SMOKE_RECEIPT_IDENTITY_REQUIRED" | "SMOKE_EXECUTION_IDENTITY_MISMATCH" | "DIAGNOSTIC_WAVESPEED_SMOKE_REQUIRED" | "SMOKE_OUTPUT_HOST_FAILURE_REQUIRED" | "SMOKE_PREDICTION_NOT_COMPLETED" | "SMOKE_RECOVERY_STATE_CHANGED" | "SMOKE_RECOVERY_GET_ONLY";
export class WaveSpeedSmokeRecoveryError extends Error {
  constructor(readonly code: RecoveryCode) { super(code); }
}
type RecoveryRow = {
  id: string; workspace_id: string; type: string; required_capability: string; billing_mode: string; idempotency_key: string;
  input_snapshot: AiVideoInput; input_hash: string; job_status: string; error_code: string | null; error_message_safe: string | null;
  attempt_count: number; max_attempts: number; cancel_requested_at: Date | null; execution_count: number; attempt_rows: number; has_billing: boolean;
  execution_id: string; attempt_id: string; provider: string; model: string; provider_policy_version: string; state: string;
  external_task_id: string | null; submit_count: number; submission_started_at: Date | null; submitted_at: Date | null;
  provider_error_code: string | null; safe_error: string | null; attempt_status: string; attempt_number: number;
  attempt_error_code: string | null; attempt_error_message_safe: string | null; recovered_before: boolean;
};
type Dependencies = {
  db?: DbClient;
  transaction?: <T>(work: (db: DbClient) => Promise<T>) => Promise<T>;
  provider?: Pick<WaveSpeedVideoProvider, "poll">;
};

function validateIdentity(identity: WaveSpeedRecoveryIdentity) {
  if (!identity || !isUuid(identity.jobId) || !isUuid(identity.workspaceId) || !isUuid(identity.templateJobId) || typeof identity.predictionId !== "string" || !/^[A-Za-z0-9_-]{4,160}$/.test(identity.predictionId) || identity.modelId !== WAVESPEED_VIDEO_MODEL) throw new WaveSpeedSmokeRecoveryError("SMOKE_RECEIPT_IDENTITY_REQUIRED");
}

// Defence in depth for the CLI: every fetch is a GET of this prediction or an
// approved video output. Even an accidental submit dispatch cannot reach the API.
export function waveSpeedRecoveryFetch(predictionId: string, fetcher: typeof fetch) {
  if (!/^[A-Za-z0-9_-]{4,160}$/.test(predictionId)) throw new WaveSpeedSmokeRecoveryError("SMOKE_RECEIPT_IDENTITY_REQUIRED");
  const counts = { predictionGets: 0, videoGets: 0, waveSpeedPosts: 0, blockedRequests: 0 };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const redirect = init?.redirect || (input instanceof Request ? input.redirect : "follow");
      if (method !== "GET" || redirect !== "manual") throw new Error();
      if (url.origin === "https://api.wavespeed.ai") {
        if (url.pathname !== `/api/v3/predictions/${predictionId}/result` || url.search || url.hash || url.username || url.password || !/^Bearer \S+$/.test(headers.get("authorization") || "")) throw new Error();
        counts.predictionGets++;
      } else {
        waveSpeedOutputUrl(url.href);
        if (headers.has("authorization")) throw new Error();
        counts.videoGets++;
      }
    } catch {
      counts.blockedRequests++;
      throw new WaveSpeedSmokeRecoveryError("SMOKE_RECOVERY_GET_ONLY");
    }
    return fetcher(input, init);
  };
  return { fetch, counts };
}
async function load(db: DbClient, identity: WaveSpeedRecoveryIdentity, lock = false) {
  const result = await db.query<RecoveryRow>(`SELECT j.id,j.workspace_id,j.type,j.required_capability,j.billing_mode,j.idempotency_key,j.input_snapshot,j.input_hash,
    j.status AS job_status,j.error_code,j.error_message_safe,j.attempt_count,j.max_attempts,j.cancel_requested_at,
    e.id AS execution_id,e.attempt_id,e.provider,e.model,e.provider_policy_version,e.state,e.external_task_id,e.submit_count,e.submission_started_at,e.submitted_at,e.provider_error_code,e.safe_error,
    a.status AS attempt_status,a.attempt_number,a.error_code AS attempt_error_code,a.error_message_safe AS attempt_error_message_safe,
    (SELECT count(*)::int FROM provider_executions p WHERE p.workspace_id=j.workspace_id AND p.job_id=j.id) AS execution_count,
    (SELECT count(*)::int FROM job_attempts t WHERE t.workspace_id=j.workspace_id AND t.job_id=j.id) AS attempt_rows,
    EXISTS(SELECT 1 FROM job_billing b WHERE b.workspace_id=j.workspace_id AND b.job_id=j.id) AS has_billing,
    EXISTS(SELECT 1 FROM job_events v WHERE v.workspace_id=j.workspace_id AND v.job_id=j.id AND v.attempt_id=e.attempt_id AND v.event_type=$3
      AND v.safe_data->>'executionId'=e.id::text AND v.safe_data->>'predictionId'=e.external_task_id AND v.safe_data->>'originalErrorCode'='OUTPUT_INVALID'
      AND v.safe_data->>'reason'='OUTPUT_HOST_POLICY_CORRECTION') AS recovered_before
    FROM jobs j JOIN provider_executions e ON e.workspace_id=j.workspace_id AND e.job_id=j.id
    JOIN job_attempts a ON a.workspace_id=j.workspace_id AND a.job_id=j.id AND a.id=e.attempt_id
    WHERE j.workspace_id=$1 AND j.id=$2 ${lock ? "FOR UPDATE OF e,j,a" : ""}`, [identity.workspaceId, identity.jobId, WAVESPEED_RECOVERY_EVENT]);
  if (result.rows.length !== 1) throw new WaveSpeedSmokeRecoveryError("SMOKE_EXECUTION_IDENTITY_MISMATCH");
  return result.rows[0];
}
function validateRow(row: RecoveryRow, identity: WaveSpeedRecoveryIdentity) {
  if (row.id !== identity.jobId || row.workspace_id !== identity.workspaceId || row.execution_count !== 1 || row.attempt_rows !== 1 || row.submit_count !== 1 || row.external_task_id !== identity.predictionId || !row.submission_started_at || !row.submitted_at) throw new WaveSpeedSmokeRecoveryError("SMOKE_EXECUTION_IDENTITY_MISMATCH");
  const input = row.input_snapshot;
  if (row.provider !== "WAVESPEED" || row.model !== identity.modelId || row.type !== "AI_VIDEO" || row.required_capability !== "CLOUD_AI_VIDEO" || row.billing_mode !== "DIAGNOSTIC" || row.has_billing || row.idempotency_key !== WAVESPEED_SMOKE_IDEMPOTENCY || row.attempt_count !== 1 || row.attempt_number !== 1 || row.max_attempts !== 1 || row.cancel_requested_at || !input || input.schemaVersion !== 1 || input.kind !== "AI_VIDEO" || input.executionProvider !== "WAVESPEED" || input.testScenario !== undefined || input.tier !== "QUALITY" || input.durationSeconds !== 4 || input.aspectRatio !== "16:9" || input.quantity !== 1 || input.customerPrompt !== waveSpeedSmokePayload.prompt || input.accuracyInstructions !== WAVESPEED_SMOKE_ACCURACY || !Array.isArray(input.referenceAssetVersionIds) || input.referenceAssetVersionIds.length !== 0 || input.providerPolicyVersion !== "wavespeed-seedance25-2026-10-03" || row.provider_policy_version !== input.providerPolicyVersion) throw new WaveSpeedSmokeRecoveryError("DIAGNOSTIC_WAVESPEED_SMOKE_REQUIRED");
  if (row.job_status === "SUCCEEDED" && row.state === "SUCCEEDED" && row.attempt_status === "SUCCEEDED") return "complete";
  if (row.job_status === "RUNNING" && row.state === "OUTPUT_PENDING" && row.attempt_status === "RUNNING" && row.recovered_before) return "pending";
  const hostFailure = row.error_code === "OUTPUT_INVALID" && row.provider_error_code === "OUTPUT_INVALID" && row.attempt_error_code === "OUTPUT_INVALID" && row.error_message_safe === WAVESPEED_HOST_FAILURE && row.safe_error === WAVESPEED_HOST_FAILURE && row.attempt_error_message_safe === WAVESPEED_HOST_FAILURE;
  // A later manual retry is permitted only if an audit event proves this exact
  // execution was originally recovered from the host defect. Keep all counters.
  const exhaustedIngest = row.recovered_before && row.error_code === "OUTPUT_UNAVAILABLE" && row.provider_error_code === "OUTPUT_UNAVAILABLE" && row.attempt_error_code === "OUTPUT_UNAVAILABLE" && row.error_message_safe === INGEST_RETRY_FAILURE && row.safe_error === INGEST_RETRY_FAILURE && row.attempt_error_message_safe === INGEST_RETRY_FAILURE;
  if (row.job_status !== "FAILED" || row.state !== "FAILED" || row.attempt_status !== "FAILED" || (!hostFailure && !exhaustedIngest)) throw new WaveSpeedSmokeRecoveryError("SMOKE_OUTPUT_HOST_FAILURE_REQUIRED");
  return hostFailure ? "failed" : "retry";
}
function summary(row: RecoveryRow, identity: WaveSpeedRecoveryIdentity, reopened = false): WaveSpeedRecoveryResult {
  return { jobId: row.id, executionId: row.execution_id, attemptId: row.attempt_id, predictionId: identity.predictionId, state: row.state === "SUCCEEDED" ? "SUCCEEDED" : "OUTPUT_PENDING", reopened };
}

// Server/operator helper for the persisted diagnostic receipt; no Job/Attempt/
// Execution creation, submission, output URL persistence, or production override.
export async function recoverWaveSpeedSmokeOutput(identity: WaveSpeedRecoveryIdentity, dependencies: Dependencies = {}) {
  validateIdentity(identity);
  const before = await load(dependencies.db || { query }, identity);
  const stage = validateRow(before, identity);
  if (stage === "complete") return summary(before, identity);
  const provider = dependencies.provider || new WaveSpeedVideoProvider();
  const poll = await provider.poll(identity.predictionId); // Authenticated GET of this exact existing prediction.
  if (poll.status !== "succeeded" || !poll.outputUrl) throw new WaveSpeedSmokeRecoveryError("SMOKE_PREDICTION_NOT_COMPLETED");
  waveSpeedOutputUrl(poll.outputUrl); // Validation only; the address remains in memory.
  const transact = dependencies.transaction || transaction;
  return transact(async (db: DbClient) => {
    const current = await load(db, identity, true), currentStage = validateRow(current, identity);
    if (current.execution_id !== before.execution_id || current.attempt_id !== before.attempt_id || current.input_hash !== before.input_hash) throw new WaveSpeedSmokeRecoveryError("SMOKE_RECOVERY_STATE_CHANGED");
    if (currentStage === "complete" || currentStage === "pending") return summary(current, identity);
    await db.query("UPDATE provider_executions SET state='OUTPUT_PENDING',provider_error_code=NULL,safe_error=NULL,completed_at=NULL,next_action_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2", [identity.workspaceId, current.execution_id]);
    await db.query("UPDATE jobs SET status='RUNNING',progress_percent=greatest(progress_percent,80),progress_stage='finalizing',progress_message='Preparing video output',error_code=NULL,error_message_safe=NULL,finished_at=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2", [identity.workspaceId, identity.jobId]);
    await db.query("UPDATE job_attempts SET status='RUNNING',error_code=NULL,error_message_safe=NULL,finished_at=NULL WHERE workspace_id=$1 AND id=$2", [identity.workspaceId, current.attempt_id]);
    await jobEvent(db, identity.workspaceId, identity.jobId, WAVESPEED_RECOVERY_EVENT, current.attempt_id, null, { provider: "WAVESPEED", executionId: current.execution_id, predictionId: identity.predictionId, originalErrorCode: "OUTPUT_INVALID", reason: currentStage === "retry" ? "RETRY_EXISTING_OUTPUT_INGEST" : "OUTPUT_HOST_POLICY_CORRECTION", recoveryMode: "OUTPUT_INGEST_ONLY" });
    return summary(current, identity, true);
  });
}
