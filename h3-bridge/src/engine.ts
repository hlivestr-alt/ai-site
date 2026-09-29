import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readComfyState, validateComfyNodes, uploadReference, submitPrompt, readHistory, reconcilePromptId, outputForJob, fetchOutput, ComfyRejectedError, watchComfyProgress, stopProgress } from "./comfy.js";
import { readCreativeState } from "./creative.js";
import { acquireGeneration, generationOwner, jobDirectory, publicJob, readJob, releaseGeneration, saveJob } from "./jobs.js";
import { transition, type JobMetadata } from "./contract.js";
import { buildWorkflow, type Workflow } from "./workflow.js";

const execFileAsync = promisify(execFile);
type Dependencies = {
  comfyState: typeof readComfyState; creativeState: typeof readCreativeState; validateNodes: typeof validateComfyNodes;
  upload: typeof uploadReference; submit: typeof submitPrompt; history: typeof readHistory;
  reconcile: typeof reconcilePromptId; output: typeof fetchOutput;
};
export const productionDeps: Dependencies = { comfyState: readComfyState, creativeState: readCreativeState, validateNodes: validateComfyNodes, upload: uploadReference, submit: submitPrompt, history: readHistory, reconcile: reconcilePromptId, output: fetchOutput };

async function idle(deps: Dependencies): Promise<{ ready: boolean; reason: string }> {
  const [comfy, creative] = await Promise.all([deps.comfyState(), deps.creativeState()]);
  if (comfy.state !== "idle") return { ready: false, reason: comfy.state === "busy" ? "H3 is currently busy in ComfyUI" : "ComfyUI is offline" };
  if (creative.state !== "idle") return { ready: false, reason: creative.reason };
  return { ready: true, reason: "idle" };
}
export async function attemptSubmission(id: string, deps: Dependencies = productionDeps) {
  const meta = await readJob(id);
  if (meta.dryRun) throw new Error("Dry-run jobs cannot be submitted");
  if (!["VALIDATED", "WAITING_FOR_GPU"].includes(meta.state) || meta.submissionCount > 0) return publicJob(meta);
  if (!(await acquireGeneration(id))) {
    if (await generationOwner() === id) return publicJob(await readJob(id));
    const current = await readJob(id);
    if (current.state === "VALIDATED" && current.submissionCount === 0) { current.state = transition(current.state, "WAITING_FOR_GPU"); await saveJob(current); }
    return publicJob(current);
  }
  let keepLock = false;
  try {
    let check = await idle(deps);
    if (!check.ready) {
      meta.state = meta.state === "VALIDATED" ? transition(meta.state, "WAITING_FOR_GPU") : meta.state;
      meta.error = check.reason; await saveJob(meta); return publicJob(meta);
    }
    let graph = JSON.parse(await readFile(join(jobDirectory(id), "workflow.json"), "utf8")) as Workflow;
    await deps.validateNodes(graph);
    const referenceDir = join(jobDirectory(id), "references");
    if (!meta.remoteReferences) {
      const remote: string[] = [];
      for (let index = 0; index < meta.referenceCount; index++) {
        const candidates = [".png", ".jpg", ".webp"];
        let filename = ""; let bytes: Buffer | null = null;
        for (const ext of candidates) {
          const candidate = `reference-${index + 1}${ext}`;
          const value = await readFile(join(referenceDir, candidate)).catch(() => null);
          if (value) { filename = candidate; bytes = value; break; }
        }
        if (!bytes) throw new Error("Stored reference is missing");
        const mime = filename.endsWith(".png") ? "image/png" : filename.endsWith(".jpg") ? "image/jpeg" : "image/webp";
        remote.push(await deps.upload(id, filename, mime, bytes));
      }
      meta.remoteReferences = remote; await saveJob(meta);
    }
    graph = await buildWorkflow({ prompt: meta.prompt, duration_seconds: meta.durationSeconds, resolution: meta.resolution ?? "576x1024", aspect_ratio: "9:16", reference_images: [] }, id, meta.remoteReferences);
    await deps.validateNodes(graph);
    check = await idle(deps);
    if (!check.ready) {
      meta.state = meta.state === "VALIDATED" ? transition(meta.state, "WAITING_FOR_GPU") : meta.state;
      meta.error = check.reason; await saveJob(meta); return publicJob(meta);
    }
    await open(join(jobDirectory(id), "workflow-submission.json"), "wx").then(async file => { try { await file.writeFile(JSON.stringify(graph, null, 2)); } finally { await file.close(); } });
    meta.state = transition(meta.state, "SUBMITTING"); meta.submissionCount = 1; meta.submittedAt = new Date().toISOString(); meta.error = undefined;
    await saveJob(meta); // irreversible submission intent precedes the only POST /prompt
    keepLock = true;
    const clientId = randomUUID(); meta.comfyClientId = clientId; await saveJob(meta);
    if (deps === productionDeps) watchComfyProgress(clientId);
    const promptId = await deps.submit(id, graph, clientId);
    meta.comfyPromptId = promptId; meta.state = transition(meta.state, "RUNNING"); await saveJob(meta);
    return publicJob(meta);
  } catch (error) {
    if (meta.submissionCount > 0) {
      if (error instanceof ComfyRejectedError) {
        meta.state = transition(meta.state, "FAILED"); meta.error = error.message;
        await saveJob(meta); keepLock = false;
        return publicJob(meta);
      }
      if (meta.state === "SUBMITTING") meta.state = transition(meta.state, "SUBMISSION_UNKNOWN");
      meta.error = "Submission outcome is uncertain. The bridge will not submit this job again.";
      await saveJob(meta); keepLock = true;
      console.error(`Bridge job ${id} submission uncertain:`, error instanceof Error ? error.message : "unknown");
      return publicJob(meta);
    }
    meta.state = transition(meta.state, "FAILED"); meta.error = error instanceof Error ? error.message : "Preparation failed";
    await saveJob(meta); return publicJob(meta);
  } finally { if (!keepLock) await releaseGeneration(id); }
}

async function copyArtifact(id: string, response: Response) {
  if (!response.body) throw new Error("Video stream was empty");
  const folder = join(jobDirectory(id), "output"); await mkdir(folder, { recursive: true });
  const temporary = join(folder, "video.partial"), final = join(folder, "video.mp4");
  const file = await open(temporary, "wx");
  let bytes = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.length;
      if (bytes > 512 * 1024 * 1024) throw new Error("Video exceeds bridge size limit");
      await file.write(chunk.value);
    }
  } finally { await file.close(); }
  if (bytes < 1024) throw new Error("Video is empty or implausibly small");
  const header = Buffer.alloc(12); const check = await open(temporary, "r");
  try { await check.read(header, 0, 12, 0); } finally { await check.close(); }
  if (header.toString("ascii", 4, 8) !== "ftyp") throw new Error("Output is not an MP4 file");
  const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", temporary], { timeout: 15000 });
  const info = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
  if (!info.streams?.[0]?.width || !info.streams[0].height) throw new Error("Output has no playable video stream");
  await rename(temporary, final);
  return { filename: "video.mp4" as const, bytes, durationSeconds: Number(info.format?.duration) || null, width: info.streams[0].width, height: info.streams[0].height };
}

export async function pollJob(id: string, deps: Dependencies = productionDeps) {
  const meta: JobMetadata = await readJob(id);
  if (meta.state === "SUBMISSION_UNKNOWN") {
    try {
      const promptId = await deps.reconcile(id);
      if (promptId) { meta.comfyPromptId = promptId; meta.state = transition(meta.state, "RUNNING"); meta.error = undefined; await saveJob(meta); }
    } catch { /* keep the uncertainty and the generation lock */ }
  }
  if (meta.state !== "RUNNING" || !meta.comfyPromptId) return publicJob(meta);
  if (deps === productionDeps && meta.comfyClientId) watchComfyProgress(meta.comfyClientId);
  try {
    const history = await deps.history(meta.comfyPromptId);
    if (!history) return publicJob(meta);
    const status = history.status && typeof history.status === "object" ? history.status as Record<string, unknown> : {};
    if (status.status_str === "error") throw new Error("H3 workflow failed in ComfyUI");
    if (status.status_str !== "success") return publicJob(meta);
    const output = outputForJob(history, meta.comfyPromptId, id);
    const stream = await deps.output(output);
    meta.output = await copyArtifact(id, stream);
    meta.state = transition(meta.state, "COMPLETED"); meta.completedAt = new Date().toISOString(); await saveJob(meta);
    stopProgress(meta.comfyClientId, meta.comfyPromptId);
    if (deps === productionDeps && process.env.BRIDGE_REAL_SUBMISSION_ENABLED === "1") await writeFile(join(process.cwd(), "data", "controlled-test.json"), JSON.stringify({ jobId: id, promptId: meta.comfyPromptId, completedAt: meta.completedAt }), { flag: "wx" }).catch(() => undefined);
    await releaseGeneration(id);
  } catch (error) {
    meta.state = transition(meta.state, "FAILED"); meta.error = error instanceof Error ? error.message : "Generation failed"; await saveJob(meta);
    stopProgress(meta.comfyClientId, meta.comfyPromptId);
    await releaseGeneration(id);
  }
  return publicJob(meta);
}

// Explicit recovery for a completed ComfyUI execution whose artifact was rejected
// by the bridge's former Windows separator check. This never calls /prompt.
export async function recoverCompletedArtifact(id: string, deps: Dependencies = productionDeps) {
  const meta = await readJob(id);
  if (meta.state !== "FAILED" || meta.submissionCount !== 1 || !meta.comfyPromptId || meta.output || meta.error !== "Output location does not match bridge job") throw new Error("Job is not eligible for artifact recovery");
  if (!(await acquireGeneration(id))) throw new Error("Bridge generation lock is busy");
  try {
    const history = await deps.history(meta.comfyPromptId);
    if (!history || (history.status as Record<string, unknown> | undefined)?.status_str !== "success") throw new Error("Recorded ComfyUI prompt did not complete successfully");
    const output = outputForJob(history, meta.comfyPromptId, id);
    const stream = await deps.output(output);
    const artifact = await copyArtifact(id, stream);
    if (artifact.width !== 576 || artifact.height !== 1024 || artifact.durationSeconds === null || Math.abs(artifact.durationSeconds - 8) > 0.5) throw new Error("Recovered artifact does not match the 8-second 576 × 1024 contract");
    meta.output = artifact; meta.state = "COMPLETED"; meta.completedAt = new Date().toISOString(); meta.error = undefined;
    await saveJob(meta);
    if (deps === productionDeps) await writeFile(join(process.cwd(), "data", "controlled-test.json"), JSON.stringify({ jobId: id, promptId: meta.comfyPromptId, completedAt: meta.completedAt }), { flag: "wx" });
    return publicJob(meta);
  } finally { await releaseGeneration(id); }
}
