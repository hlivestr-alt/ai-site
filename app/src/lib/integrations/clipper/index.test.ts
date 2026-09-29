import assert from "node:assert/strict";
import { test } from "node:test";
import { clipperBaseUrl, getClipperOverview } from "./index";
import { planClipperJob } from "./submission";

test("Clipper accepts only loopback HTTP", () => {
  assert.equal(clipperBaseUrl("http://127.0.0.1:8765"), "http://127.0.0.1:8765");
  assert.throws(() => clipperBaseUrl("http://remote.example:8765"));
  assert.throws(() => clipperBaseUrl("https://127.0.0.1:8765"));
});

test("Clipper adapter reads only allowed endpoints and strips filesystem paths", async () => {
  const paths: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    const data = path === "/api/health" ? { status: "ok" } : path === "/api/queue" ? { rows: [{ run_id: "r1", video_name: "VOD", status: "running", progress: 42, clips_generated: 1, output_dir: "D:/private" }] } : path === "/api/queue/vods" ? { files: [{ name: "x.mp4", path: "D:/private/x.mp4", size: 100 }] } : { rows: [{ score_key: "s1", source_video: "VOD", total_score: 8, status: "scored", output_file: "D:/private/clip.mp4" }] };
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
  const overview = await getClipperOverview(fetcher);
  assert.equal(overview.state, "connected");
  assert.deepEqual(paths.sort(), ["/api/health", "/api/queue", "/api/queue/vods", "/api/scores"].sort());
  assert.equal(JSON.stringify(overview).includes("D:/private"), false);
});

test("Clipper offline state and bounded submission plan never start work", async () => {
  const offline = await getClipperOverview((async () => { throw new Error("offline"); }) as typeof fetch);
  assert.equal(offline.message, "Clipper is offline");
  assert.equal(offline.jobs.length, 0);
  const plan = planClipperJob("vod.mp4", 3, ["vod.mp4"]);
  assert.equal(plan.launch_config.run_mode, "single_video");
  assert.throws(() => planClipperJob("../other.mp4", 3, ["vod.mp4"]));
});
