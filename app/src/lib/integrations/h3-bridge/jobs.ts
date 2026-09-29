import { bridgeUrl, getBridgeStatus } from "./index";

export type VideoJob = { id: string; state: "CREATED" | "VALIDATED" | "WAITING_FOR_GPU" | "SUBMITTING" | "SUBMISSION_UNKNOWN" | "RUNNING" | "COMPLETED" | "FAILED"; createdAt: string; updatedAt: string; completedAt: string | null; prompt: string; durationSeconds: number; resolution?: string; progress?: number | null; aspectRatio: "9:16"; referenceCount: number; dryRun: boolean; comfyPromptId: string | null; output: { filename: string; bytes: number; durationSeconds: number | null; width: number | null; height: number | null } | null; error: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validJobId(id: string) { return uuid.test(id); }

async function bridgeRequest(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`${bridgeUrl()}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(120000) });
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Video request failed";
    throw new Error(message);
  }
  return data;
}
export async function createVideoJob(form: FormData, fetcher: typeof fetch = fetch, statusFetcher: typeof fetch = fetch): Promise<VideoJob> {
  const status = await getBridgeStatus(statusFetcher);
  if (!status.readyToGenerate) throw new Error("AI Video is currently unavailable");
  const prompt = form.get("prompt"), duration = Number(form.get("duration_seconds")), resolution = form.get("resolution") ?? "576x1024", ratio = form.get("aspect_ratio"), key = form.get("idempotency_key");
  if (typeof prompt !== "string" || prompt.trim().length < 10 || prompt.length > 4000) throw new Error("Prompt must be 10–4,000 characters");
  if (!status.capabilities?.durations.includes(duration)) throw new Error("Unsupported video duration");
  if (typeof resolution !== "string" || !status.capabilities.resolutions.includes(resolution)) throw new Error("Unsupported video resolution");
  if (ratio !== "9:16") throw new Error("Only 9:16 is supported");
  if (typeof key !== "string" || !validJobId(key)) throw new Error("Request key is invalid");
  const files = form.getAll("reference_images");
  if (files.length < 1 || files.length > 2 || files.some(file => !(file instanceof File))) throw new Error("Choose one or two reference images");
  const references = await Promise.all((files as File[]).map(async (file, i) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error(`Reference ${i + 1} must be PNG, JPEG, or WebP and at most 10 MB`);
    const extension = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp";
    return { filename: `reference-${i + 1}.${extension}`, mime_type: file.type, data_base64: Buffer.from(await file.arrayBuffer()).toString("base64") };
  }));
  return await bridgeRequest("/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, duration_seconds: duration, resolution, aspect_ratio: ratio, reference_images: references, dry_run: false, idempotency_key: key }) }, fetcher) as VideoJob;
}
export async function listVideoJobs(fetcher: typeof fetch = fetch): Promise<VideoJob[]> {
  const result = await bridgeRequest("/jobs", {}, fetcher) as { jobs?: VideoJob[] };
  return Array.isArray(result.jobs) ? result.jobs.filter(job => job.dryRun === false) : [];
}
export async function getVideoJob(id: string, fetcher: typeof fetch = fetch): Promise<VideoJob> {
  if (!validJobId(id)) throw new Error("Invalid job ID");
  return await bridgeRequest(`/jobs/${id}`, {}, fetcher) as VideoJob;
}
export async function retryWaitingJob(id: string, fetcher: typeof fetch = fetch): Promise<VideoJob> {
  if (!validJobId(id)) throw new Error("Invalid job ID");
  return await bridgeRequest(`/jobs/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, fetcher) as VideoJob;
}
