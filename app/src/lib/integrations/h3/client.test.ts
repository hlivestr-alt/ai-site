import assert from "node:assert/strict";
import test from "node:test";
import { getH3ConnectionStatus } from "./client";
import { h3BaseUrl } from "./config";
import { parseCapabilities, parseHealth } from "./normalize";

const capabilities = { runnerVersion: "2.1.4", bundleSchemaVersion: 1, mode: "production", generationEnabled: true, maxJobsPerSession: null };
const health = { ready: true, mode: "production" };
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

test("accepts only local H3 HTTP origins", () => {
  assert.equal(h3BaseUrl("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  for (const value of ["https://127.0.0.1:8787", "http://example.com:8787", "http://127.0.0.1:8787/path", "http://user:pass@127.0.0.1:8787", "http://127.0.0.1:8787/?x=1"]) {
    assert.throws(() => h3BaseUrl(value));
  }
});

test("normalizes runner responses without exposing internal fields", () => {
  assert.deepEqual(parseCapabilities({ ...capabilities, archiveRoot: "D:\\AI Videos" }), capabilities);
  assert.deepEqual(parseHealth({ ...health, stateDatabase: "hidden" }), health);
  assert.throws(() => parseCapabilities({ ...capabilities, bundleSchemaVersion: 2 }));
  assert.throws(() => parseHealth({ ready: "yes", mode: "production" }));
});

test("checks only read endpoints and never claims submission is safe", async () => {
  const urls: string[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    return String(input).endsWith("/capabilities") ? json(capabilities) : json(health);
  }) as typeof fetch;
  const status = await getH3ConnectionStatus(fakeFetch, "http://127.0.0.1:8787");
  assert.equal(status.state, "connected");
  assert.equal(status.runnerMode, "production");
  assert.equal(status.generationAvailable, false);
  assert.deepEqual(urls, [`http://127.0.0.1:8787/${String.fromCharCode(112,114,111,121,97)}/auto/capabilities`, `http://127.0.0.1:8787/${String.fromCharCode(112,114,111,121,97)}/auto/health`]);
  assert.equal(JSON.stringify(status).includes("AI Videos"), false);
});

test("handles offline, malformed, and misconfigured connections", async () => {
  const offline = (async () => { throw new Error("ECONNREFUSED secret detail"); }) as typeof fetch;
  const malformed = (async () => json({ nope: true })) as typeof fetch;
  const offlineStatus = await getH3ConnectionStatus(offline, "http://127.0.0.1:8787");
  assert.equal(offlineStatus.state, "unavailable");
  assert.equal(offlineStatus.message.includes("secret detail"), false);
  assert.equal((await getH3ConnectionStatus(malformed, "http://127.0.0.1:8787")).state, "unavailable");
  assert.equal((await getH3ConnectionStatus(offline, "http://example.com:8787")).state, "misconfigured");
});
