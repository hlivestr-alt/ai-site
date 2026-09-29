import assert from "node:assert/strict";
import { test } from "node:test";
import { createVideoJob, getVideoJob, listVideoJobs, retryWaitingJob } from "./jobs";

const id = "11111111-1111-4111-8111-111111111111";
const job = { id, state: "WAITING_FOR_GPU", prompt: "A quiet skincare bottle on a clean table", dryRun: false };
const ready = (async () => Response.json({ service: "ai-site-h3-bridge", validation: "ready", generation: "available", readyToGenerate: true, comfy: "idle", creative: "idle" })) as typeof fetch;
const expanded = (async () => Response.json({ service: "ai-site-h3-bridge", validation: "ready", generation: "available", readyToGenerate: true, comfy: "idle", creative: "idle", capabilities: { durations: [4, 8, 15], resolutions: ["480x864", "576x1024", "768x1344"] } })) as typeof fetch;
function form() {
  const data = new FormData(); data.set("prompt", job.prompt); data.set("duration_seconds", "8"); data.set("aspect_ratio", "9:16"); data.set("idempotency_key", id);
  data.append("reference_images", new File([new Uint8Array([137, 80, 78, 71])], "unsafe-name.png", { type: "image/png" }));
  return data;
}

test("platform forwards one uploaded reference and a stable request key", async () => {
  let posts = 0;
  const bridge = (async (_url: string, init?: RequestInit) => {
    posts++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.reference_images[0].filename, "reference-1.png");
    assert.equal(body.reference_images[0].data_base64, "iVBORw==");
    assert.equal(body.idempotency_key, id);
    assert.equal(body.dry_run, false);
    return Response.json(job);
  }) as typeof fetch;
  assert.equal((await createVideoJob(form(), bridge, ready)).state, "WAITING_FOR_GPU");
  assert.equal((await createVideoJob(form(), bridge, ready)).id, id);
  assert.equal(posts, 2);
});

test("platform accepts advertised options and rejects unadvertised duration and resolution", async () => {
  const bridge = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.duration_seconds, 15);
    assert.equal(body.resolution, "768x1344");
    return Response.json(job);
  }) as typeof fetch;
  const selected = form(); selected.set("duration_seconds", "15"); selected.set("resolution", "768x1344");
  await createVideoJob(selected, bridge, expanded);
  selected.set("duration_seconds", "10");
  await assert.rejects(() => createVideoJob(selected, bridge, expanded), /duration/);
  selected.set("duration_seconds", "15"); selected.set("resolution", "720x1280");
  await assert.rejects(() => createVideoJob(selected, bridge, expanded), /resolution/);
});

test("poll, explicit waiting retry, completion, failure, and history map bridge jobs", async () => {
  const results = [job, { ...job, state: "RUNNING" }, { ...job, state: "COMPLETED", output: { filename: "video.mp4", bytes: 2208 } }, { ...job, state: "FAILED", error: "Generation failed" }];
  let index = 0;
  const bridge = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/jobs")) return Response.json({ jobs: [results[2], { ...job, dryRun: true }] });
    assert.match(url, new RegExp(id));
    if (init?.method === "POST") return Response.json(results[1]);
    return Response.json(results[index++]);
  }) as typeof fetch;
  assert.equal((await getVideoJob(id, bridge)).state, "WAITING_FOR_GPU");
  assert.equal((await retryWaitingJob(id, bridge)).state, "RUNNING");
  assert.equal((await getVideoJob(id, bridge)).state, "RUNNING");
  assert.equal((await getVideoJob(id, bridge)).state, "COMPLETED");
  assert.equal((await getVideoJob(id, bridge)).state, "FAILED");
  assert.equal((await listVideoJobs(bridge)).length, 1);
});

test("offline or unavailable H3 prevents creation", async () => {
  const offline = (async () => { throw new Error("offline"); }) as typeof fetch;
  await assert.rejects(() => createVideoJob(form(), offline, offline), /unavailable/);
  const unavailable = (async () => Response.json({ service: "ai-site-h3-bridge", validation: "ready", generation: "test_only", readyToGenerate: false, comfy: "busy", creative: "idle" })) as typeof fetch;
  await assert.rejects(() => createVideoJob(form(), unavailable, unavailable), /unavailable/);
});
