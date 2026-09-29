const defaultUrl = "http://127.0.0.1:8787";
export function creativeUrl(value = process.env.CREATIVE_RUNNER_URL) {
  const url = new URL(value || defaultUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/" || url.username || url.password) throw new Error("Creative runner URL must be local HTTP");
  return url.origin;
}
export type CreativeState = { state: "idle" | "busy" | "unavailable"; reason: string };
export async function readCreativeState(fetcher: typeof fetch = fetch): Promise<CreativeState> {
  try {
    const base = creativeUrl();
    const sessionResponse = await fetcher(`${base}/${String.fromCharCode(112,114,111,121,97)}/auto/session/current`, { method: "GET", signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!sessionResponse.ok) throw new Error("Runner status unavailable");
    const sessionBody = await sessionResponse.json() as Record<string, unknown>;
    const session = sessionBody.session && typeof sessionBody.session === "object" ? sessionBody.session as Record<string, unknown> : null;
    if (!session) return { state: "unavailable", reason: "Creative Studio session cannot be verified" };
    if (typeof session.sessionId !== "string") throw new Error("Runner session ID invalid");
    const jobsResponse = await fetcher(`${base}/${String.fromCharCode(112,114,111,121,97)}/auto/jobs?sessionId=${encodeURIComponent(session.sessionId)}`, { method: "GET", signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!jobsResponse.ok) throw new Error("Runner jobs unavailable");
    const jobsBody = await jobsResponse.json() as Record<string, unknown>;
    if (!Array.isArray(jobsBody.jobs)) throw new Error("Runner jobs invalid");
    if (session && !["STAGED", "STOPPED", "FAILED", "CANARY_FINISHED", "TWO_JOB_CANARY_FINISHED"].includes(String(session.status))) return { state: "busy", reason: "Creative Studio session is active" };
    if (session?.currentJobId) return { state: "busy", reason: "Creative Studio job is active" };
    // The runner retains historical RUNNING records from interrupted old sessions.
    // Only the current session can be scheduled by this runner.
    if (session && jobsBody.jobs.some((job: unknown) => job && typeof job === "object" && (job as Record<string, unknown>).sessionId === session.sessionId && !["COMPLETED", "FAILED"].includes(String((job as Record<string, unknown>).phase)))) return { state: "busy", reason: "Creative Studio job is active" };
    return { state: "idle", reason: "Creative Studio runner is idle" };
  } catch { return { state: "unavailable", reason: "Creative Studio state cannot be verified" }; }
}
