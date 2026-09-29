import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { authEnabled } from "./auth/config";
import { readSession, SESSION_COOKIE } from "./auth/session";

type Action = "campaign.create" | "campaign.preview" | "campaign.freeze" | "campaign.queue" | "h3.request";
type Result = "attempt" | "accepted" | "rejected" | "already-queued";
type Actor = "operator" | "unauthenticated";
type Details = { campaignId?: unknown; jobId?: unknown; count?: unknown };
const idPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

// Explicit field allowlist: never serialize request bodies, headers, native errors, or uploads.
export function auditRecord(action: Action, result: Result, actor: Actor, details: Details = {}) {
  return {
    timestamp: new Date().toISOString(), action, result, actor,
    ...(typeof details.campaignId === "string" && idPattern.test(details.campaignId) ? { campaignId: details.campaignId } : {}),
    ...(typeof details.jobId === "string" && idPattern.test(details.jobId) ? { jobId: details.jobId } : {}),
    ...(typeof details.count === "number" && Number.isSafeInteger(details.count) && details.count >= 0 ? { count: details.count } : {}),
  };
}

export async function auditActor(request: Request): Promise<Actor> {
  if (!authEnabled()) return "unauthenticated";
  const token = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return (await readSession(token))?.user === "operator" ? "operator" : "unauthenticated";
}

export async function audit(action: Action, result: Result, request: Request, details: Details = {}) {
  try {
    const record = auditRecord(action, result, await auditActor(request), details);
    const directory = resolve(process.cwd(), "data", "audit");
    await mkdir(directory, { recursive: true });
    await appendFile(resolve(directory, `${record.timestamp.slice(0, 10)}.jsonl`), JSON.stringify(record) + "\n", { mode: 0o600 });
  } catch {
    // Do not report a successful native action as failed and encourage a retry if logging fails.
    console.warn("[audit] storage unavailable");
  }
}
