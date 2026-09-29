import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { buildWorkflow } from "./workflow.js";
import { progressFor } from "./comfy.js";
import { isUuid, transition, validateRequest, type JobMetadata } from "./contract.js";

const dataRoot = resolve(process.env.BRIDGE_DATA_DIR || join(process.cwd(), "data"));
export const root = resolve(dataRoot, "jobs");
const generationLock = resolve(dataRoot, "generation.lock");
let locked = false;
export function acquire(): () => void {
  if (locked) throw new Error("Bridge validation is busy");
  locked = true;
  let released = false;
  return () => { if (!released) { locked = false; released = true; } };
}
export function bridgeBusy() { return locked; }
export function jobDirectory(id: string) {
  if (!isUuid(id) || isAbsolute(id)) throw new Error("Invalid job ID");
  const path = resolve(root, id);
  if (!path.startsWith(root + sep)) throw new Error("Job path escapes bridge storage");
  return path;
}
export async function saveJob(meta: JobMetadata) {
  meta.updatedAt = new Date().toISOString();
  const path = join(jobDirectory(meta.id), "metadata.json"), temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(meta, null, 2), { flag: "wx" });
  await rename(temporary, path);
  await writeFile(join(jobDirectory(meta.id), "events.jsonl"), JSON.stringify({ at: meta.updatedAt, state: meta.state, promptId: meta.comfyPromptId ?? null, error: meta.error ?? null }) + "\n", { flag: "a" });
}
export async function readJob(id: string): Promise<JobMetadata> { return JSON.parse(await readFile(join(jobDirectory(id), "metadata.json"), "utf8")) as JobMetadata; }
export function publicError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? "");
  if (/ComfyUI|workflow|bridge/i.test(message)) return "Video generation failed. Contact an administrator for details.";
  if (/busy|active|offline|unavailable|cannot be verified/i.test(message)) return message;
  if (/reference|image|duration|aspect|prompt|idempotency|request/i.test(message) && !/[A-Z]:\\|\/data\/|ENOENT|EACCES/i.test(message)) return message;
  return "Video generation failed. Contact an administrator for details.";
}
export function publicJob(meta: JobMetadata) {
  return { id: meta.id, state: meta.state, createdAt: meta.createdAt, updatedAt: meta.updatedAt, completedAt: meta.completedAt ?? null,
    prompt: meta.prompt, durationSeconds: meta.durationSeconds, resolution: meta.resolution ?? "576x1024", aspectRatio: meta.aspectRatio, referenceCount: meta.referenceCount,
    progress: meta.state === "COMPLETED" ? 100 : meta.state === "FAILED" ? null : meta.state === "RUNNING" ? progressFor(meta.comfyPromptId) : 0,
    dryRun: meta.dryRun, comfyPromptId: meta.comfyPromptId ?? null, output: meta.output ?? null, error: meta.error ? publicError(meta.error) : null };
}
export async function createJob(value: unknown) {
  const release = acquire();
  try {
    const { request, references, inputHash } = await validateRequest(value);
    const id = request.idempotency_key ?? randomUUID(), directory = jobDirectory(id);
    await mkdir(root, { recursive: true });
    try { await mkdir(directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readJob(id);
      if (existing.inputHash !== inputHash) throw new Error("Idempotency key was already used for a different request");
      return { job: publicJob(existing), created: false };
    }
    const now = new Date().toISOString();
    const meta: JobMetadata = { id, state: "CREATED", createdAt: now, updatedAt: now, prompt: request.prompt.trim(), durationSeconds: request.duration_seconds, resolution: request.resolution ?? "576x1024", aspectRatio: request.aspect_ratio, referenceCount: references.length, dryRun: request.dry_run === true, inputHash, submissionCount: 0, progress: 0 };
    await writeFile(join(directory, "metadata.json"), JSON.stringify(meta, null, 2), { flag: "wx" });
    await writeFile(join(directory, "events.jsonl"), JSON.stringify({ at: now, state: "CREATED" }) + "\n", { flag: "wx" });
    try {
      const referenceDir = join(directory, "references"); await mkdir(referenceDir);
      for (const reference of references) await writeFile(join(referenceDir, reference.filename), reference.bytes, { flag: "wx" });
      const workflow = await buildWorkflow(request, id, references.map(r => r.filename));
      await writeFile(join(directory, "workflow.json"), JSON.stringify(workflow, null, 2), { flag: "wx" });
      meta.state = transition(meta.state, "VALIDATED"); await saveJob(meta);
      return { job: publicJob(meta), created: true };
    } catch (error) {
      meta.state = transition(meta.state, "FAILED"); meta.error = error instanceof Error ? error.message : "Workflow validation failed"; await saveJob(meta); throw error;
    }
  } finally { release(); }
}
export async function createDryRun(value: unknown) { return (await createJob(value)).job; }
export async function getJob(id: string) { return publicJob(await readJob(id)); }
export async function listJobs() {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const jobs = await Promise.all(entries.filter(e => e.isDirectory() && isUuid(e.name)).map(async e => readJob(e.name).catch(() => null)));
  return jobs.filter((job): job is JobMetadata => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50).map(publicJob);
}
export async function acquireGeneration(id: string): Promise<boolean> {
  try { const file = await open(generationLock, "wx"); try { await file.writeFile(id); } finally { await file.close(); } return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
}
export async function releaseGeneration(id: string) {
  const owner = await readFile(generationLock, "utf8").catch(() => null);
  if (owner === id) await unlink(generationLock);
}
export async function generationOwner() { return readFile(generationLock, "utf8").catch(() => null); }
