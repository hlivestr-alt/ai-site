import type { Workflow } from "./workflow.js";
import { legacyIdentityKey, legacyNamespace } from "./legacy.js";

const defaultUrl = "http://127.0.0.1:8188";
const liveProgress = new Map<string, number>();
const watchers = new Map<string, WebSocket>();
export function normalizeComfyProgress(value: unknown, max: unknown): number | null {
  if (typeof value !== "number" || typeof max !== "number" || !Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return null;
  return Math.max(0, Math.min(99, Math.floor(value / max * 100)));
}
export function progressFor(promptId: string | undefined): number { return promptId ? liveProgress.get(promptId) ?? 0 : 0; }
export function applyComfyProgressEvent(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const message = payload as { type?: unknown; data?: unknown };
  if (message.type !== "progress" || !message.data || typeof message.data !== "object") return;
  const data = message.data as Record<string, unknown>;
  if (typeof data.prompt_id !== "string" || !/^[0-9a-f-]{36}$/.test(data.prompt_id)) return;
  const percent = normalizeComfyProgress(data.value, data.max);
  if (percent !== null) liveProgress.set(data.prompt_id, Math.max(liveProgress.get(data.prompt_id) ?? 0, percent));
}
export function stopProgress(clientId: string | undefined, promptId: string | undefined) {
  if (clientId) { watchers.get(clientId)?.close(); watchers.delete(clientId); }
  if (promptId) liveProgress.delete(promptId);
}
export function watchComfyProgress(clientId: string) {
  if (watchers.has(clientId)) return;
  let socket: WebSocket;
  try { socket = new WebSocket(`${comfyUrl().replace(/^http/, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`); }
  catch { return; } // Progress telemetry must never change submission semantics.
  watchers.set(clientId, socket);
  socket.addEventListener("message", event => {
    try {
      if (typeof event.data !== "string") return;
      applyComfyProgressEvent(JSON.parse(event.data));
    } catch { /* Ignore malformed or unrelated events. */ }
  });
  socket.addEventListener("close", () => { if (watchers.get(clientId) === socket) watchers.delete(clientId); });
  socket.addEventListener("error", () => { socket.close(); });
}
export class ComfyRejectedError extends Error {}
export function comfyUrl(value = process.env.COMFYUI_URL) {
  const url = new URL(value || defaultUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/" || url.username || url.password) throw new Error("ComfyUI URL must be local HTTP");
  return url.origin;
}
export type ComfyState = { state: "idle" | "busy" | "offline"; running: number; pending: number };
async function json(path: string, fetcher: typeof fetch = fetch, init: RequestInit = {}, timeoutMs = 5000): Promise<unknown> {
  const response = await fetcher(`${comfyUrl()}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!response.ok) {
    if (path === "/prompt" && response.status === 400) throw new ComfyRejectedError("ComfyUI rejected the workflow (HTTP 400)");
    throw new Error(`ComfyUI ${path} returned ${response.status}`);
  }
  return response.json();
}
export async function readComfyState(fetcher: typeof fetch = fetch): Promise<ComfyState> {
  try {
    const queue = await json("/queue", fetcher) as Record<string, unknown>;
    if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error("Invalid queue");
    const running = queue.queue_running.length, pending = queue.queue_pending.length;
    return { state: running || pending ? "busy" : "idle", running, pending };
  } catch { return { state: "offline", running: 0, pending: 0 }; }
}
export function canDispatch(state: ComfyState, bridgeBusy: boolean): boolean { return state.state === "idle" && !bridgeBusy; }

export async function validateComfyNodes(graph: Workflow, fetcher: typeof fetch = fetch) {
  const info = await json("/object_info", fetcher, {}, 15000) as Record<string, unknown>;
  for (const node of Object.values(graph)) if (!(node.class_type in info)) throw new Error(`ComfyUI node unavailable: ${node.class_type}`);
}

export type Uploaded = { name: string; subfolder: string; type: "input" };
export async function uploadReference(jobId: string, filename: string, mimeType: string, bytes: Buffer, fetcher: typeof fetch = fetch): Promise<string> {
  const subfolder = `ai_site/${jobId}`;
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  form.append("type", "input"); form.append("subfolder", subfolder); form.append("overwrite", "false");
  const raw = await json("/upload/image", fetcher, { method: "POST", body: form }, 30000) as Uploaded;
  if (raw.type !== "input" || raw.subfolder !== subfolder || typeof raw.name !== "string" || !/^reference-[12](?: \(\d+\))?\.(png|jpg|webp)$/.test(raw.name)) throw new Error("ComfyUI returned an unexpected upload location");
  const check = new URLSearchParams({ filename: raw.name, subfolder, type: "input" });
  const verify = await fetcher(`${comfyUrl()}/view?${check}`, { method: "GET", signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!verify.ok || !verify.body) throw new Error("Uploaded reference cannot be read from ComfyUI input storage");
  await verify.body.cancel();
  return raw.name;
}

export async function submitPrompt(jobId: string, graph: Workflow, clientId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const raw = await json("/prompt", fetcher, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: graph, client_id: clientId, extra_data: { aiSiteBridgeJobId: jobId } }) }, 30000) as Record<string, unknown>;
  if (raw.error || (raw.node_errors && typeof raw.node_errors === "object" && Object.keys(raw.node_errors).length > 0)) throw new Error("ComfyUI rejected the workflow");
  if (typeof raw.prompt_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw.prompt_id)) throw new Error("ComfyUI returned no reliable prompt ID");
  return raw.prompt_id;
}

export async function readHistory(promptId: string, fetcher: typeof fetch = fetch): Promise<Record<string, unknown> | null> {
  const payload = await json(`/history/${encodeURIComponent(promptId)}`, fetcher, {}, 10000) as Record<string, unknown>;
  const entry = payload[promptId];
  return entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
}

export function historyIdentity(entry: Record<string, unknown>): string | null {
  const prompt = entry.prompt;
  if (!Array.isArray(prompt) || !prompt[3] || typeof prompt[3] !== "object") return null;
  const extra = prompt[3] as Record<string, unknown>;
  const identity = extra.aiSiteBridgeJobId ?? extra[legacyIdentityKey];
  return typeof identity === "string" ? identity : null;
}

export async function reconcilePromptId(jobId: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const [queueRaw, historyRaw] = await Promise.all([json("/queue", fetcher), json("/history?max_items=100", fetcher, {}, 10000)]);
  const queue = queueRaw as Record<string, unknown>, history = historyRaw as Record<string, unknown>;
  const found: string[] = [];
  for (const group of [queue.queue_running, queue.queue_pending]) if (Array.isArray(group)) for (const row of group) {
    if (Array.isArray(row) && typeof row[1] === "string" && row[3] && typeof row[3] === "object") {
      const extra = row[3] as Record<string, unknown>;
      if ((extra.aiSiteBridgeJobId ?? extra[legacyIdentityKey]) === jobId) found.push(row[1]);
    }
  }
  for (const [id, entry] of Object.entries(history)) if (entry && typeof entry === "object" && historyIdentity(entry as Record<string, unknown>) === jobId) found.push(id);
  const unique = [...new Set(found)];
  if (unique.length > 1) throw new Error("Multiple ComfyUI prompts match one bridge job");
  return unique[0] ?? null;
}

export function outputForJob(entry: Record<string, unknown>, promptId: string, jobId: string) {
  if (historyIdentity(entry) !== jobId) throw new Error("History job identity mismatch");
  const prompt = entry.prompt;
  if (!Array.isArray(prompt) || prompt[1] !== promptId) throw new Error("History prompt ID mismatch");
  const outputs = entry.outputs && typeof entry.outputs === "object" ? entry.outputs as Record<string, unknown> : {};
  const node = outputs["92"] && typeof outputs["92"] === "object" ? outputs["92"] as Record<string, unknown> : {};
  const images = Array.isArray(node.images) ? node.images : [];
  if (images.length !== 1) throw new Error("SaveVideo must produce exactly one artifact");
  const file = images[0] as Record<string, unknown>;
  const normalizedSubfolder = typeof file.subfolder === "string" ? file.subfolder.replaceAll("\\", "/") : "";
  const matchingNamespace = normalizedSubfolder === `ai_site/${jobId}` || normalizedSubfolder === `${legacyNamespace}/${jobId}`;
  if (file.type !== "output" || !matchingNamespace || typeof file.filename !== "string" || !/^video[^/\\]*\.mp4$/i.test(file.filename)) throw new Error("Output location does not match bridge job");
  return { filename: file.filename as string, subfolder: file.subfolder as string, type: "output" as const };
}

export async function fetchOutput(output: { filename: string; subfolder: string; type: "output" }, fetcher: typeof fetch = fetch): Promise<Response> {
  const query = new URLSearchParams(output);
  const response = await fetcher(`${comfyUrl()}/view?${query}`, { method: "GET", signal: AbortSignal.timeout(120000), cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("ComfyUI video artifact is unavailable");
  return response;
}
