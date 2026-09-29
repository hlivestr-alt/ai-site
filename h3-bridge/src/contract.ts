import { createHash } from "node:crypto";
import sharp from "sharp";

export const SUPPORTED_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const SUPPORTED_RESOLUTIONS = [
  { width: 480, height: 864, megapixels: 0.4 },
  { width: 576, height: 1024, megapixels: 0.5625 },
  { width: 640, height: 1152, megapixels: 0.7 },
  { width: 768, height: 1344, megapixels: 0.98 },
] as const;
export const RESOLUTION = { ...SUPPORTED_RESOLUTIONS[1], fps: 24 } as const;
export function resolutionFor(value: unknown) {
  const resolution = SUPPORTED_RESOLUTIONS.find(item => `${item.width}x${item.height}` === value);
  if (!resolution) throw new Error("Unsupported video resolution");
  return resolution;
}
export type ReferenceInput = { filename: string; mime_type: "image/png" | "image/jpeg" | "image/webp"; data_base64: string };
export type JobRequest = { prompt: string; duration_seconds: number; resolution?: string; aspect_ratio: "9:16"; reference_images: ReferenceInput[]; dry_run?: boolean; idempotency_key?: string };
export type JobState = "CREATED" | "VALIDATED" | "WAITING_FOR_GPU" | "SUBMITTING" | "SUBMISSION_UNKNOWN" | "RUNNING" | "COMPLETED" | "FAILED";
export type JobMetadata = {
  id: string; state: JobState; createdAt: string; updatedAt: string; prompt: string;
  durationSeconds: number; resolution?: string; aspectRatio: "9:16"; referenceCount: number; dryRun: boolean; inputHash: string; progress?: number;
  comfyPromptId?: string; comfyClientId?: string; submissionCount: number; submittedAt?: string; completedAt?: string;
  remoteReferences?: string[]; error?: string;
  output?: { filename: "video.mp4"; bytes: number; durationSeconds: number | null; width: number | null; height: number | null };
};

const mimeExtensions: Record<ReferenceInput["mime_type"], string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function isUuid(value: unknown): value is string { return typeof value === "string" && uuid.test(value); }
export function frameCount(durationSeconds: number): number {
  if (!SUPPORTED_DURATIONS.includes(durationSeconds as typeof SUPPORTED_DURATIONS[number])) throw new Error("Unsupported video duration");
  return Math.min(5 + 17 * Math.ceil((durationSeconds * RESOLUTION.fps - 5) / 17), 362);
}

export async function validateRequest(value: unknown): Promise<{ request: JobRequest; references: { filename: string; bytes: Buffer; mimeType: ReferenceInput["mime_type"] }[]; inputHash: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Job request must be an object");
  const x = value as Record<string, unknown>;
  if (x.dry_run !== undefined && typeof x.dry_run !== "boolean") throw new Error("dry_run must be boolean");
  if (typeof x.prompt !== "string" || x.prompt.trim().length < 10 || x.prompt.length > 4000) throw new Error("Prompt must be 10–4,000 characters");
  if (typeof x.duration_seconds !== "number") throw new Error("Unsupported video duration");
  frameCount(x.duration_seconds);
  resolutionFor(x.resolution ?? "576x1024");
  if (x.aspect_ratio !== "9:16") throw new Error("Only 9:16 is supported");
  if (!Array.isArray(x.reference_images) || x.reference_images.length < 1 || x.reference_images.length > 2) throw new Error("One or two reference images are required");
  if (x.dry_run !== true && !isUuid(x.idempotency_key)) throw new Error("A UUID idempotency_key is required for generation");
  const references = await Promise.all(x.reference_images.map(async (raw: unknown, i: number) => {
    if (!raw || typeof raw !== "object") throw new Error(`Reference ${i + 1} is invalid`);
    const item = raw as Record<string, unknown>;
    if (typeof item.filename !== "string" || item.filename.length < 1 || item.filename.length > 150 || item.filename.includes("..") || /[/\\:]/.test(item.filename)) throw new Error(`Reference ${i + 1} filename is invalid`);
    if (typeof item.mime_type !== "string" || !(item.mime_type in mimeExtensions)) throw new Error(`Reference ${i + 1} type is unsupported`);
    const mimeType = item.mime_type as ReferenceInput["mime_type"];
    if (typeof item.data_base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data_base64)) throw new Error(`Reference ${i + 1} data is invalid`);
    const bytes = Buffer.from(item.data_base64, "base64");
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 || bytes.toString("base64") !== item.data_base64) throw new Error(`Reference ${i + 1} must be at most 10 MB`);
    const info = await sharp(bytes, { failOn: "error", limitInputPixels: 4096 * 4096 }).metadata().catch(() => { throw new Error(`Reference ${i + 1} is not a decodable image`); });
    const format = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" }[mimeType];
    if (info.format !== format || !info.width || !info.height || info.width > 4096 || info.height > 4096 || info.pages && info.pages > 1) throw new Error(`Reference ${i + 1} type or dimensions are unsupported`);
    await sharp(bytes, { failOn: "error", limitInputPixels: 4096 * 4096 }).stats().catch(() => { throw new Error(`Reference ${i + 1} cannot be fully decoded`); });
    return { filename: `reference-${i + 1}${mimeExtensions[mimeType]}`, bytes, mimeType };
  }));
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ prompt: x.prompt.trim(), duration: x.duration_seconds, resolution: x.resolution ?? "576x1024", ratio: x.aspect_ratio, dryRun: x.dry_run === true }));
  for (const reference of references) hash.update(reference.bytes);
  return { request: x as JobRequest, references, inputHash: hash.digest("hex") };
}

const transitions: Record<JobState, JobState[]> = {
  CREATED: ["VALIDATED", "FAILED"], VALIDATED: ["WAITING_FOR_GPU", "SUBMITTING", "FAILED"],
  WAITING_FOR_GPU: ["SUBMITTING", "FAILED"], SUBMITTING: ["RUNNING", "SUBMISSION_UNKNOWN", "FAILED"],
  SUBMISSION_UNKNOWN: ["RUNNING", "FAILED"], RUNNING: ["COMPLETED", "FAILED"], COMPLETED: [], FAILED: [],
};
export function transition(state: JobState, next: JobState): JobState {
  if (!transitions[state].includes(next)) throw new Error(`Invalid job transition ${state} → ${next}`);
  return next;
}
