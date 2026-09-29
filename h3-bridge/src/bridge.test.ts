import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { readComfyState, canDispatch, outputForJob, ComfyRejectedError, uploadReference, normalizeComfyProgress, applyComfyProgressEvent, stopProgress } from "./comfy.js";
import { readCreativeState } from "./creative.js";
import { frameCount, transition, validateRequest, RESOLUTION, SUPPORTED_DURATIONS, SUPPORTED_RESOLUTIONS, resolutionFor, type JobMetadata } from "./contract.js";
import { attemptSubmission, pollJob, productionDeps } from "./engine.js";
import { acquire, createJob, getJob, jobDirectory, readJob, releaseGeneration, publicJob, publicError } from "./jobs.js";
import { buildWorkflow, validateWorkflow } from "./workflow.js";
import { createBridgeServer } from "./server.js";
import { legacyIdentityKey, legacyNamespace } from "./legacy.js";

const promptId = "11111111-1111-4111-8111-111111111111";
const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } }).png().toBuffer();
function request(overrides: Record<string, unknown> = {}) { return { prompt: "A harmless portrait skincare video with a product", duration_seconds: 8, aspect_ratio: "9:16", reference_images: [{ filename: "product.png", mime_type: "image/png", data_base64: image.toString("base64") }], dry_run: true, ...overrides }; }
function mocks(overrides: Partial<typeof productionDeps> = {}): typeof productionDeps { return {
  comfyState: async () => ({ state: "idle", running: 0, pending: 0 }), creativeState: async () => ({ state: "idle", reason: "idle" }),
  validateNodes: async () => undefined, upload: async (_id, name) => name,
  submit: async () => promptId, history: async () => null, reconcile: async () => null,
  output: async () => new Response(null, { status: 404 }), ...overrides,
}; }
function history(id: string, withOutput = true) { return { prompt: [0, promptId, {}, { aiSiteBridgeJobId: id }, ["92"]], status: { status_str: "success" }, outputs: { "92": { images: withOutput ? [{ filename: "video_00001_.mp4", subfolder: `ai_site/${id}`, type: "output" }] : [] } } }; }

test("historical artifacts remain readable without accepting another job's output", () => {
  const id = randomUUID();
  const entry = history(id);
  entry.prompt[3] = { [legacyIdentityKey]: id };
  entry.outputs["92"].images[0].subfolder = `${legacyNamespace}\\${id}`;
  assert.equal(outputForJob(entry, promptId, id).subfolder, `${legacyNamespace}\\${id}`);
  assert.throws(() => outputForJob(entry, promptId, randomUUID()), /identity mismatch/);
  entry.outputs["92"].images[0].subfolder = `${legacyNamespace}/../${id}`;
  assert.throws(() => outputForJob(entry, promptId, id), /location/);
});

test("validates decoded images, limits, and safe generated names", async () => {
  const valid = await validateRequest(request({ reference_images: [request().reference_images[0], request().reference_images[0]] }));
  assert.deepEqual(valid.references.map(r => r.filename), ["reference-1.png", "reference-2.png"]);
  await assert.rejects(() => validateRequest(request({ reference_images: [{ ...request().reference_images[0], filename: "../evil.png" }] })), /filename/);
  await assert.rejects(() => validateRequest(request({ reference_images: [] })), /reference/);
  await assert.rejects(() => validateRequest(request({ reference_images: [1, 2, 3] })), /reference/);
  await assert.rejects(() => validateRequest(request({ reference_images: [{ ...request().reference_images[0], mime_type: "image/jpeg" }] })), /type/);
  await assert.rejects(() => validateRequest(request({ reference_images: [{ ...request().reference_images[0], data_base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") }] })), /10 MB/);
  await assert.rejects(() => validateRequest(request({ duration_seconds: 3 })), /duration/);
  await assert.rejects(() => validateRequest(request({ duration_seconds: 8.5 })), /duration/);
  await assert.rejects(() => validateRequest(request({ duration_seconds: "8" })), /duration/);
  await assert.rejects(() => validateRequest(request({ resolution: "720x1280" })), /resolution/);
});

test("native H3 duration and portrait resolution options map deterministically to the graph", async () => {
  assert.deepEqual(SUPPORTED_DURATIONS, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  for (const duration of SUPPORTED_DURATIONS) {
    const graph = await buildWorkflow(request({ duration_seconds: duration }) as never, randomUUID(), ["reference-1.png"]);
    assert.equal(graph["131"].inputs.expression, `${frameCount(duration)} + 0`);
    assert.equal(frameCount(duration) % 17, 5);
  }
  for (const resolution of SUPPORTED_RESOLUTIONS) {
    const name = `${resolution.width}x${resolution.height}`;
    assert.equal(resolutionFor(name), resolution);
    const graph = await buildWorkflow(request({ resolution: name }) as never, randomUUID(), ["reference-1.png"]);
    assert.equal(graph["115"].inputs.megapixels, resolution.megapixels);
  }
});

test("Comfy sampler progress is bounded and rejects non-progress values", () => {
  assert.equal(normalizeComfyProgress(42, 100), 42);
  assert.equal(normalizeComfyProgress(-5, 100), 0);
  assert.equal(normalizeComfyProgress(120, 100), 99);
  assert.equal(normalizeComfyProgress(1, 0), null);
  assert.equal(normalizeComfyProgress("42", 100), null);
  const meta = { id: randomUUID(), comfyPromptId: promptId, state: "RUNNING" } as JobMetadata;
  assert.equal(publicJob(meta).progress, 0);
  applyComfyProgressEvent({ type: "progress", data: { prompt_id: promptId, value: 42, max: 100 } });
  assert.equal(publicJob(meta).progress, 42);
  const otherPromptId = "22222222-2222-4222-8222-222222222222";
  applyComfyProgressEvent({ type: "progress", data: { prompt_id: otherPromptId, value: 90, max: 100 } });
  assert.equal(publicJob(meta).progress, 42);
  assert.equal(publicJob({ ...meta, comfyPromptId: otherPromptId }).progress, 90);
  applyComfyProgressEvent({ type: "progress", data: { prompt_id: promptId, value: 130, max: 100 } });
  assert.equal(publicJob(meta).progress, 99);
  assert.equal(publicJob({ ...meta, state: "COMPLETED" } as never).progress, 100);
  assert.equal(publicJob({ ...meta, state: "FAILED" } as never).progress, null);
  assert.equal(publicJob({ ...meta, state: "WAITING_FOR_GPU" } as never).progress, 0);
  stopProgress(undefined, promptId);
  stopProgress(undefined, otherPromptId);
  assert.doesNotMatch(publicError(new Error("H3 workflow failed in ComfyUI")), /ComfyUI|workflow|bridge/);
});

test("8 seconds maps to 192 frames and exact 9:16 576 × 1024 output", async () => {
  assert.equal(frameCount(8), 192); assert.equal(RESOLUTION.width / RESOLUTION.height, 9 / 16);
  const graph = await buildWorkflow(request() as never, randomUUID(), ["reference-1.png"]);
  assert.equal(graph["131"].inputs.expression, "192 + 0");
  assert.equal(graph["115"].inputs.megapixels, 0.5625);
  assert.equal(graph["136"].inputs.prompt?.toString(), "138,0");
  assert.equal("152" in graph, false);
  assert.equal(Object.values(graph).filter(n => n.class_type === "SaveVideo").length, 1);
  assert.throws(() => validateWorkflow({ ...graph, "999": { class_type: "SaveVideo", inputs: {} } }, 1), /exactly one/);
  await assert.rejects(() => buildWorkflow(request() as never, randomUUID(), ["ai_site/doubled/reference-1.png"]), /upload name/);
});

test("ComfyUI upload uses a unique subfolder and returns a filename only", async () => {
  const id = randomUUID();
  const fetcher = (async (url: string, init?: RequestInit) => {
    if (url.includes("/view?")) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("subfolder"), `ai_site/${id}`);
      assert.equal(parsed.searchParams.get("filename"), "reference-1.png");
      return new Response(new Uint8Array(image), { status: 200 });
    }
    const form = init?.body as FormData;
    assert.equal(form.get("subfolder"), `ai_site/${id}`);
    assert.equal(form.get("overwrite"), "false");
    return Response.json({ name: "reference-1.png", subfolder: `ai_site/${id}`, type: "input" });
  }) as typeof fetch;
  assert.equal(await uploadReference(id, "reference-1.png", "image/png", image, fetcher), "reference-1.png");
});

test("job path, state persistence, and transitions", async () => {
  assert.throws(() => jobDirectory("../../Creative Studio"));
  assert.equal(transition("CREATED", "VALIDATED"), "VALIDATED");
  assert.throws(() => transition("VALIDATED", "COMPLETED"));
  const job = await createJob(request());
  assert.equal(job.job.state, "VALIDATED");
  assert.equal((await getJob(job.job.id)).state, "VALIDATED");
  assert.equal((await readFile(join(jobDirectory(job.job.id), "references", "reference-1.png"))).length, image.length);
});

test("Comfy and Creative busy states block submission without failure", async () => {
  let submitted = 0;
  const busyComfy = mocks({ comfyState: async () => ({ state: "busy", running: 1, pending: 0 }), submit: async () => { submitted++; return promptId; } });
  const one = await createJob(request({ dry_run: false, idempotency_key: randomUUID() }));
  assert.equal((await attemptSubmission(one.job.id, busyComfy)).state, "WAITING_FOR_GPU");
  const busyCreative = mocks({ creativeState: async () => ({ state: "busy", reason: "Creative Studio session is active" }), submit: async () => { submitted++; return promptId; } });
  const two = await createJob(request({ dry_run: false, idempotency_key: randomUUID() }));
  assert.equal((await attemptSubmission(two.job.id, busyCreative)).state, "WAITING_FOR_GPU");
  assert.equal(submitted, 0);
  assert.equal(canDispatch({ state: "offline", running: 0, pending: 0 }, false), false);
  assert.equal((await readComfyState((async () => { throw new Error("offline"); }) as typeof fetch)).state, "offline");
  assert.equal((await readCreativeState((async () => { throw new Error("offline"); }) as typeof fetch)).state, "unavailable");
});

test("Creative Studio current session determines activity, not stale old jobs", async () => {
  const current = { session: { sessionId: "current", status: "STOPPED", currentJobId: null } };
  const jobs = { jobs: [{ sessionId: "older", phase: "RUNNING" }] };
  const fetcher = (async (url: string) => Response.json(url.includes("/jobs?") ? jobs : current)) as typeof fetch;
  assert.equal((await readCreativeState(fetcher)).state, "idle");
  jobs.jobs.push({ sessionId: "current", phase: "RUNNING" });
  assert.equal((await readCreativeState(fetcher)).state, "busy");
});

test("exclusive lock and idempotency ensure one workflow submission", async () => {
  const release = acquire(); try { await assert.rejects(() => createJob(request()), /busy/); } finally { release(); }
  const id = randomUUID(); const input = request({ dry_run: false, idempotency_key: id });
  const first = await createJob(input), duplicate = await createJob(input);
  assert.equal(first.created, true); assert.equal(duplicate.created, false);
  await assert.rejects(() => createJob(request({ ...input, prompt: "A different harmless prompt for the same key" })), /Idempotency/);
  let calls = 0;
  const deps = mocks({ submit: async () => { calls++; return promptId; } });
  assert.equal((await attemptSubmission(id, deps)).state, "RUNNING");
  assert.equal((await attemptSubmission(id, deps)).state, "RUNNING");
  assert.equal(calls, 1); assert.equal((await readJob(id)).comfyPromptId, promptId);
  assert.equal((await readJob(id)).submissionCount, 1);
  await releaseGeneration(id);
});

test("ambiguous submission is never retried and can reconcile by persisted identity", async () => {
  const id = randomUUID(); await createJob(request({ dry_run: false, idempotency_key: id }));
  let calls = 0;
  const deps = mocks({ submit: async () => { calls++; throw new Error("response lost"); }, reconcile: async () => promptId });
  assert.equal((await attemptSubmission(id, deps)).state, "SUBMISSION_UNKNOWN");
  assert.equal((await attemptSubmission(id, deps)).state, "SUBMISSION_UNKNOWN");
  assert.equal(calls, 1);
  assert.equal((await pollJob(id, deps)).state, "RUNNING");
  assert.equal((await readJob(id)).comfyPromptId, promptId);
  await releaseGeneration(id);
});

test("definite ComfyUI workflow rejection fails without a second submission", async () => {
  const id = randomUUID(); await createJob(request({ dry_run: false, idempotency_key: id }));
  let calls = 0;
  const deps = mocks({ submit: async () => { calls++; throw new ComfyRejectedError("ComfyUI rejected the workflow (HTTP 400)"); } });
  assert.equal((await attemptSubmission(id, deps)).state, "FAILED");
  assert.equal((await attemptSubmission(id, deps)).state, "FAILED");
  assert.equal(calls, 1);
});

test("history ties output to exact prompt and isolated job; missing output fails", async () => {
  const id = randomUUID(); await createJob(request({ dry_run: false, idempotency_key: id }));
  assert.throws(() => outputForJob(history(id), randomUUID(), id), /prompt ID/);
  assert.throws(() => outputForJob(history(id), promptId, randomUUID()), /identity/);
  assert.equal(outputForJob(history(id), promptId, id).filename, "video_00001_.mp4");
  const windowsHistory = history(id); windowsHistory.outputs["92"].images[0].subfolder = `ai_site\\${id}`;
  assert.equal(outputForJob(windowsHistory, promptId, id).subfolder, `ai_site\\${id}`);
  const deps = mocks({ history: async () => history(id, false) });
  await attemptSubmission(id, deps);
  assert.equal((await pollJob(id, deps)).state, "FAILED");
});

test("successful mocked history copies playable MP4 and artifact endpoint supports ranges", async () => {
  const id = randomUUID(); await createJob(request({ dry_run: false, idempotency_key: id }));
  const video = await readFile(join(process.cwd(), "test-fixtures", "fixture.mp4"));
  const deps = mocks({ history: async () => history(id), output: async () => new Response(new Uint8Array(video), { status: 200 }) });
  await attemptSubmission(id, deps);
  const result = await pollJob(id, deps);
  assert.equal(result.state, "COMPLETED"); assert.equal(result.output?.width, 64); assert.equal(result.output?.height, 64);
  assert.equal((await readFile(join(jobDirectory(id), "output", "video.mp4"))).length, video.length);
  const server = createBridgeServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No test port");
    const response = await fetch(`http://127.0.0.1:${address.port}/jobs/${id}/artifact`, { headers: { Range: "bytes=0-99" } });
    assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 100);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("real submission feature flag denies HTTP generation before job creation", async () => {
  const previous = process.env.BRIDGE_REAL_SUBMISSION_ENABLED;
  delete process.env.BRIDGE_REAL_SUBMISSION_ENABLED;
  const server = createBridgeServer(); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No test port");
    const response = await fetch(`http://127.0.0.1:${address.port}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request({ dry_run: false, idempotency_key: randomUUID() })) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "Generation is not enabled" });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.BRIDGE_REAL_SUBMISSION_ENABLED;
    else process.env.BRIDGE_REAL_SUBMISSION_ENABLED = previous;
  }
});
