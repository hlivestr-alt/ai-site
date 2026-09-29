import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readComfyState, validateComfyNodes } from "./comfy.js";
import { readCreativeState } from "./creative.js";
import { bridgeBusy, createJob, generationOwner, jobDirectory, listJobs, publicError, readJob } from "./jobs.js";
import { attemptSubmission, pollJob } from "./engine.js";
import { buildWorkflow } from "./workflow.js";
import { SUPPORTED_DURATIONS, SUPPORTED_RESOLUTIONS } from "./contract.js";

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage) {
  let length = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { length += chunk.length; if (length > 30 * 1024 * 1024) throw new Error("Request exceeds 30 MB"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}
async function workflowReady() {
  try {
    const graph = await buildWorkflow({ prompt: "A simple portrait skincare test", duration_seconds: 8, aspect_ratio: "9:16", reference_images: [] }, "00000000-0000-4000-8000-000000000000", ["reference-1.png"]);
    await validateComfyNodes(graph);
    return true;
  } catch { return false; }
}
async function health() {
  const [comfy, creative, workflow, lock, marker] = await Promise.all([
    readComfyState(), readCreativeState(), workflowReady(), generationOwner(),
    readFile(resolve(process.cwd(), "data", "controlled-test.json"), "utf8").then(() => true).catch(() => false),
  ]);
  const enabled = process.env.BRIDGE_REAL_SUBMISSION_ENABLED === "1";
  const idle = comfy.state === "idle" && creative.state === "idle" && !lock;
  return { service: "ai-site-h3-bridge", validation: workflow ? "ready" : "unavailable", generation: !enabled ? "disabled" : marker && workflow ? "available" : "test_only", readyToGenerate: Boolean(enabled && marker && workflow && idle), comfy: comfy.state, creative: creative.state, queueBusy: comfy.state === "busy", bridgeBusy: Boolean(lock) || bridgeBusy(), capabilities: { durations: SUPPORTED_DURATIONS, resolutions: SUPPORTED_RESOLUTIONS.map(({ width, height }) => `${width}x${height}`), aspectRatios: ["9:16"] } };
}
async function artifact(id: string, request: IncomingMessage, response: ServerResponse) {
  const meta = await readJob(id);
  if (meta.state !== "COMPLETED" || !meta.output) return json(response, 409, { error: "Video is not completed" });
  const path = join(jobDirectory(id), "output", "video.mp4");
  const size = (await stat(path)).size;
  const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start < 0 || end < start || start >= size) { response.writeHead(416, { "Content-Range": `bytes */${size}` }); return response.end(); }
  response.writeHead(match ? 206 : 200, { "Content-Type": "video/mp4", "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(match ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) });
  createReadStream(path, { start, end }).pipe(response);
}
export async function handle(request: IncomingMessage, response: ServerResponse) {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  if (request.method === "GET" && pathname === "/health") return json(response, 200, await health());
  if (request.method === "GET" && pathname === "/jobs") return json(response, 200, { jobs: await listJobs() });
  if (request.method === "POST" && pathname === "/jobs") {
    if (!request.headers["content-type"]?.startsWith("application/json")) return json(response, 415, { error: "JSON request required" });
    try {
      const input = await body(request) as Record<string, unknown>;
      if (input.dry_run !== true && process.env.BRIDGE_REAL_SUBMISSION_ENABLED !== "1") return json(response, 503, { error: "Generation is not enabled" });
      const created = await createJob(input);
      const job = created.created && input.dry_run !== true ? await attemptSubmission(created.job.id) : created.job;
      return json(response, created.created ? 201 : 200, job);
    } catch (error) { return json(response, error instanceof Error && error.message.includes("busy") ? 429 : 400, { error: publicError(error) }); }
  }
  const match = /^\/jobs\/([0-9a-f-]{36})(\/artifact|\/submit)?$/.exec(pathname);
  if (match && request.method === "POST" && match[2] === "/submit") {
    if (process.env.BRIDGE_REAL_SUBMISSION_ENABLED !== "1") return json(response, 503, { error: "Generation is not enabled" });
    if (!request.headers["content-type"]?.startsWith("application/json")) return json(response, 415, { error: "JSON request required" });
    try { return json(response, 200, await attemptSubmission(match[1])); } catch { return json(response, 400, { error: "Job cannot be submitted" }); }
  }
  if (match && request.method === "GET") {
    try { return match[2] === "/artifact" ? artifact(match[1], request, response) : json(response, 200, await pollJob(match[1])); }
    catch { return json(response, 404, { error: "Job not found" }); }
  }
  return json(response, 404, { error: "Endpoint not found" });
}

const port = Number(process.env.PORT || 8788);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid bridge port");
export function createBridgeServer() { return createServer((request, response) => { void handle(request, response).catch(() => json(response, 500, { error: "Bridge request failed" })); }); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) createBridgeServer().listen(port, "127.0.0.1", () => { console.log(`AI Site H3 bridge listening on 127.0.0.1:${port}`); });
