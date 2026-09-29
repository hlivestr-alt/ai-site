import assert from "node:assert/strict";
import { test } from "node:test";
import { getOutreachSystemStatus } from "./status";

test("native system status maps outbound capability without exposing raw service data", async () => {
  const fetcher = (async () => new Response(JSON.stringify({ outbound: { enabled: true, mode: "LIVE", token: "private" }, workers: { outbound: "RUNNING" }, tiktok: { secret: "private" } }))) as typeof fetch;
  const status = await getOutreachSystemStatus(fetcher);
  assert.equal(status.sender, "available");
  assert.equal(status.worker, "RUNNING");
  assert.equal(JSON.stringify(status).includes("private"), false);
});

test("sender is unavailable when the native worker is stopped", async () => {
  const fetcher = (async () => Response.json({ outbound: { enabled: true, mode: "LIVE" }, workers: { outbound: "STOPPED" } })) as typeof fetch;
  const status = await getOutreachSystemStatus(fetcher);
  assert.equal(status.sender, "unavailable");
  assert.equal(status.worker, "STOPPED");
});
