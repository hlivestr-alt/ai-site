const DEFAULT_URL = "http://127.0.0.1:8765";
const timeoutMs = 4000;

export type ClipperOverview = {
  state: "connected" | "disconnected" | "misconfigured";
  message: string;
  queueStatus: string | null;
  sources: { name: string; size: number; modifiedAt: string | null }[];
  jobs: { id: string; name: string; status: string; step: string | null; progress: number; clips: number; startedAt: string | null; completedAt: string | null }[];
  results: { id: string; source: string; product: string | null; score: number | null; status: string }[];
};

export function clipperBaseUrl(value = process.env.CLIPPER_API_URL): string {
  const url = new URL(value || DEFAULT_URL);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Clipper must use a plain local HTTP origin");
  }
  return url.origin;
}

async function read(path: string, base: string, fetcher: typeof fetch) {
  const response = await fetcher(`${base}${path}`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Clipper returned ${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("data" in body)) throw new Error("Unexpected Clipper response");
  return (body as { data: unknown }).data;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}
function str(value: unknown): string { return typeof value === "string" ? value : ""; }
function nullableStr(value: unknown): string | null { return typeof value === "string" ? value : null; }
function num(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

export async function getClipperOverview(fetcher: typeof fetch = fetch): Promise<ClipperOverview> {
  let base: string;
  try { base = clipperBaseUrl(); }
  catch { return { state: "misconfigured", message: "Clipper address is invalid.", queueStatus: null, sources: [], jobs: [], results: [] }; }
  try {
    const health = record(await read("/api/health", base, fetcher));
    if (health.status !== "ok") throw new Error("Clipper health check failed");
    const [queueRaw, sourcesRaw, scoresRaw] = await Promise.all([
      read("/api/queue?limit=25", base, fetcher),
      read("/api/queue/vods", base, fetcher),
      read("/api/scores?limit=25", base, fetcher),
    ]);
    const queue = record(queueRaw), sources = record(sourcesRaw), scores = record(scoresRaw);
    return {
      state: "connected", message: "Clipper is connected. Queue, watched sources, and score records are read-only.",
      queueStatus: nullableStr(queue.queue_status),
      sources: list(sources.files).map(x => ({ name: str(x.name), size: num(x.size), modifiedAt: nullableStr(x.modified_at) })),
      jobs: list(queue.rows).map(x => ({ id: str(x.run_id), name: str(x.video_name), status: str(x.status), step: nullableStr(x.current_step), progress: Math.max(0, Math.min(100, num(x.progress))), clips: num(x.clips_generated), startedAt: nullableStr(x.started_at), completedAt: nullableStr(x.completed_at) })),
      results: list(scores.rows).map(x => ({ id: str(x.score_key), source: str(x.source_video), product: nullableStr(x.product), score: typeof x.total_score === "number" ? x.total_score : null, status: str(x.status) })),
    };
  } catch {
    return { state: "disconnected", message: "Clipper is offline", queueStatus: null, sources: [], jobs: [], results: [] };
  }
}
