import assert from "node:assert/strict";
import { test } from "node:test";
import { bridgeUrl, getBridgeStatus } from "./index";

test("bridge URL stays local and health never enables generation", async () => {
  assert.throws(() => bridgeUrl("http://remote.example:8788"));
  const fetcher = (async () => new Response(JSON.stringify({ service: "ai-site-h3-bridge", validation: "ready", generation: "disabled", comfy: "idle" }))) as typeof fetch;
  const status = await getBridgeStatus(fetcher);
  assert.equal(status.state, "connected");
  assert.equal(status.generation, "disabled");
});

test("completed validation enables generation only while both systems are idle", async () => {
  const response = { service: "ai-site-h3-bridge", validation: "ready", generation: "available", readyToGenerate: true, comfy: "idle", creative: "idle" };
  const fetcher = (async () => Response.json(response)) as typeof fetch;
  assert.equal((await getBridgeStatus(fetcher)).readyToGenerate, true);
  response.comfy = "busy";
  const busy = await getBridgeStatus(fetcher);
  assert.equal(busy.readyToGenerate, false);
  assert.equal(busy.message, "H3 is currently busy with another generation.");
});
