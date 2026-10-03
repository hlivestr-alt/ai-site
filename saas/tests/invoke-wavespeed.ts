import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { query, transaction, pool } from "../src/lib/db";
import { insertJob, dispatchOne, type AiVideoInput } from "../src/lib/job-core";
import { processProviderOne, reserveProviderOne } from "../src/lib/provider-core";
import { publishJobContent } from "../src/lib/content-publication";

const [workspaceId, templateId, mode] = process.argv.slice(2);
const key = "wavespeed-integration-fixture-not-real";
let submissions = 0, polls = 0, downloads = 0;
async function main() {
  if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL || process.env.OBJECT_STORAGE_BUCKET !== process.env.TEST_OBJECT_STORAGE_BUCKET) throw new Error("ISOLATED_TARGETS_REQUIRED");
  Object.assign(process.env, { VIDEO_PROVIDER: "wavespeed", WAVESPEED_API_KEY: key, PROVIDER_MAX_CONCURRENCY: "100", PROVIDER_WORKSPACE_CONCURRENCY: "100" });
  delete process.env.WAVESPEED_VIDEO_BASE_URL; delete process.env.WAVESPEED_SEEDANCE_MODEL;
  const template = (await query<{ input_snapshot: AiVideoInput; created_by: string }>("SELECT input_snapshot,created_by FROM jobs WHERE workspace_id=$1 AND id=$2", [workspaceId, templateId])).rows[0];
  const input: AiVideoInput = { ...template.input_snapshot, executionProvider: "WAVESPEED", providerPolicyVersion: "wavespeed-seedance25-2026-10-03", referenceAssetVersionIds: mode === "reference-unavailable" ? template.input_snapshot.referenceAssetVersionIds : [] };
  delete input.testScenario;
  const created = await transaction(db => insertJob(db, { workspaceId, createdBy: template.created_by, type: "AI_VIDEO", capability: "CLOUD_AI_VIDEO", input, idempotencyKey: randomUUID(), maxAttempts: 1, billingMode: "DIAGNOSTIC" }));
  const id = created.id, externalId = "pred_" + id.replaceAll("-", ""), output = "https://d2p7pge43lyniu.cloudfront.net/output/fixture.mp4";
  const bytes = mode === "invalid-mp4" ? Buffer.from("not an mp4") : await readFile("tests/fixtures/clipper-output.mp4");
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.wavespeed.ai/api/v3/")) {
      if (init?.method === "POST") { submissions++; if (mode === "unknown") throw new Error(key); return Response.json({ code: 200, data: { id: externalId, status: "created" } }); }
      polls++; if (mode === "poll-rate-limit" && polls === 1) return new Response(key, { status: 429 });
      return Response.json({ code: 200, data: { id: externalId, status: mode === "failed" ? "failed" : "completed", outputs: [mode === "invalid-host" ? "https://evil.example/video.mp4" : output], error: key } });
    }
    if (String(url) === output) { downloads++; return new Response(bytes, { headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.length) } }); }
    throw new Error("UNEXPECTED_FETCH");
  };
  await dispatchOne(id); await reserveProviderOne(id); await processProviderOne(id);
  for (let i = 0; i < 5; i++) { await query("UPDATE provider_executions SET next_action_at=now() WHERE job_id=$1", [id]); await processProviderOne(id); }
  const job = (await query<{ status: string; result: Record<string, unknown>; error_code: string; input_snapshot: unknown }>("SELECT status,result,error_code,input_snapshot FROM jobs WHERE id=$1", [id])).rows[0];
  const execution = (await query("SELECT state,submit_count,poll_count,ingest_count FROM provider_executions WHERE job_id=$1", [id])).rows[0];
  const artifacts = (await query("SELECT id,status,storage_key,sha256,byte_size FROM job_artifacts WHERE job_id=$1", [id])).rows;
  let contentIds: string[] = [];
  if (job.status === "SUCCEEDED") contentIds = await publishJobContent(workspaceId, id);
  const persisted = (await query("SELECT to_jsonb(j)::text AS document FROM jobs j WHERE id=$1 UNION ALL SELECT to_jsonb(e)::text FROM provider_executions e WHERE job_id=$1 UNION ALL SELECT to_jsonb(a)::text FROM job_artifacts a WHERE job_id=$1 UNION ALL SELECT to_jsonb(e)::text FROM job_events e WHERE job_id=$1", [id])).rows;
  if (persisted.some(r => r.document.includes(key) || r.document.includes(output))) throw new Error("PRIVATE_RESPONSE_LEAK");
  console.log(JSON.stringify({ id, job, execution, submissions, polls, downloads, artifacts, contentIds, expectedSha256: createHash("sha256").update(bytes).digest("hex") }));
}
main().catch(() => { console.error(JSON.stringify({ code: "WAVESPEED_INTEGRATION_FAILED" })); process.exitCode = 1; }).finally(() => pool().end());
