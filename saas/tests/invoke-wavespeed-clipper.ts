import { randomUUID } from "node:crypto";
import { query, transaction, pool } from "../src/lib/db";
import { insertJob, dispatchOne, type ClipperInput } from "../src/lib/job-core";
const [workspaceId, templateId] = process.argv.slice(2);
async function main() {
  if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("ISOLATED_TARGET_REQUIRED");
  const template = (await query<{ input_snapshot: ClipperInput; created_by: string }>("SELECT input_snapshot,created_by FROM jobs WHERE workspace_id=$1 AND id=$2 AND type='CLIPPER' AND status='CANCELLED'", [workspaceId, templateId])).rows[0];
  const input: ClipperInput = { ...template.input_snapshot, analyzerProvider: "wavespeed", analyzerModel: "openai/gpt-5.6-luna" };
  const created = await transaction(db => insertJob(db, { workspaceId, createdBy: template.created_by, type: "CLIPPER", capability: "CLIPPER_V1", input, idempotencyKey: randomUUID(), maxAttempts: 1, billingMode: "DIAGNOSTIC" }));
  await dispatchOne(created.id);
  console.log(JSON.stringify({ id: created.id, model: input.analyzerModel }));
}
main().catch(() => { console.error(JSON.stringify({ code: "WAVESPEED_CLIPPER_FIXTURE_FAILED" })); process.exitCode = 1; }).finally(() => pool().end());
