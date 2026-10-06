import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { WaveSpeedVideoProvider, waveSpeedReferenceSettings, waveSpeedOutputUrl } from "../../src/lib/video-providers/wavespeed";
import { ProviderSafeError, SubmissionUnknownError } from "../../src/lib/video-providers/types";
import { videoConfigured, providerForNewJob, providerForExecution, activeVideoPolicy } from "../../src/lib/video-providers";
import { clipAnalyzerProvider, clipperConfigured, configurationChecks, externalConfiguration } from "../../src/lib/operational-config";
import type { AiVideoInput } from "../../src/lib/job-core";
import type { ObjectStorage } from "../../src/lib/storage";
import type { DbClient } from "../../src/lib/db";
import { waveSpeedBase, WAVESPEED_VIDEO_MODEL } from "../../src/lib/wavespeed-config";
import { prepareClipperInput } from "../../src/lib/clipper-operation";
import { clipperRequest } from "../../src/lib/clipper-core";
import type { SourceRow } from "../../src/lib/sources";

const key = "wavespeed-fixture-never-log";
const id = "pred_fixture_123";
const output = "https://d2p7pge43lyniu.cloudfront.net/output/fixture.mp4";
const bytes = Buffer.from("private-reference-fixture");
const input: AiVideoInput = { schemaVersion: 1, kind: "AI_VIDEO", customerPrompt: "A slow camera move around the saved Product.", accuracyInstructions: "Preserve the saved packaging text.", tier: "QUALITY", durationSeconds: 4, aspectRatio: "9:16", quantity: 1, referenceAssetVersionIds: [], providerPolicyVersion: "wavespeed-seedance25-2026-10-03", executionProvider: "WAVESPEED", product: { id, versionId: id, versionNumber: 1, ruleVersionId: id, ruleVersionNumber: 1, information: { name: "Fixture" }, rules: {}, assets: [{ assetId: id, assetVersionId: id, type: "IMAGE", purpose: "FRONT", storageKey: "private/original", byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/png" }] } };
function fixtureEnv() { const saved = { ...process.env }; Object.assign(process.env, { APP_ENV: "local", APP_BASE_URL: "http://127.0.0.1:3200", VIDEO_PROVIDER: "wavespeed", WAVESPEED_API_KEY: key, WAVESPEED_SEEDANCE_MODEL: WAVESPEED_VIDEO_MODEL }); delete process.env.WAVESPEED_VIDEO_BASE_URL; return () => { process.env = saved; }; }
function json(data: unknown, status = 200) { return new Response(JSON.stringify({ code: status, data }), { status, headers: { "Content-Type": "application/json" } }); }
function fetcher(fn: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch { return ((url, init) => fn(String(url), init)) as typeof fetch; }
function errorCode(code: string, retryable?: boolean) { return (error: unknown) => error instanceof ProviderSafeError && error.code === code && (retryable === undefined || error.retryable === retryable); }

test("WaveSpeed submit uses the documented payload, exact model and data.id", async () => {
  const restore = fixtureEnv(); try {
    let calls = 0;
    const provider = new WaveSpeedVideoProvider({ fetch: fetcher(async (url, init) => {
      calls++; assert.equal(url, "https://api.wavespeed.ai/api/v3/" + WAVESPEED_VIDEO_MODEL);
      assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "manual");
      assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${key}`);
      const payload = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(payload).sort(), ["aspect_ratio", "duration", "generate_audio", "prompt", "reference_images", "resolution"]);
      assert.equal(payload.duration, 4); assert.equal(payload.resolution, "720p"); assert.equal(payload.generate_audio, false);
      assert.ok(payload.prompt.includes(input.customerPrompt) && payload.prompt.includes(input.accuracyInstructions));
      assert.ok(!payload.prompt.includes(key)); assert.deepEqual(payload.reference_images, []);
      return json({ id, status: "created", model: WAVESPEED_VIDEO_MODEL });
    }) });
    assert.deepEqual(await provider.submit(input, WAVESPEED_VIDEO_MODEL), { externalTaskId: id }); assert.equal(calls, 1);
    await assert.rejects(provider.submit(input, "different-model"), errorCode("PROVIDER_UNAVAILABLE")); assert.equal(calls, 1);
    for (const durationSeconds of [3, 31, 4.5, NaN]) assert.throws(() => provider.validateInput({ ...input, durationSeconds }));
    assert.equal(providerForNewJob().name, "WAVESPEED"); assert.equal(providerForExecution("BYTEPLUS").name, "BYTEPLUS");
  } finally { restore(); }
});

test("lost responses, 408, 5xx, redirects, malformed envelopes and missing prediction IDs are ambiguous; no POST replay", async () => {
  const restore = fixtureEnv(); try {
    for (const answer of [() => { throw new Error(key); }, () => new Response("", { status: 503 }), () => new Response("", { status: 408 }), () => new Response("", { status: 302 }), () => new Response("{"), () => json({}), () => json({ id: "bad/id" }), () => new Response(JSON.stringify({ code: 500, data: { id } }))]) {
      let calls = 0; const provider = new WaveSpeedVideoProvider({ fetch: fetcher(async () => { calls++; return answer(); }) });
      await assert.rejects(provider.submit(input, WAVESPEED_VIDEO_MODEL), SubmissionUnknownError);
      assert.equal(calls, 1); assert.equal(await provider.findBySubmissionToken(), null);
      assert.ok(!provider.mapError(new Error(key)).message.includes(key));
    }
    let calls = 0; const busy = new WaveSpeedVideoProvider({ fetch: fetcher(async () => { calls++; return new Response("provider error " + key, { status: 429 }); }) });
    await assert.rejects(busy.submit(input, WAVESPEED_VIDEO_MODEL), errorCode("PROVIDER_RATE_LIMIT", true)); assert.equal(calls, 1);
    const rejected = new WaveSpeedVideoProvider({ fetch: fetcher(async () => new Response(key, { status: 400 })) });
    await assert.rejects(rejected.submit(input, WAVESPEED_VIDEO_MODEL), errorCode("PROVIDER_REJECTED", false));
  } finally { restore(); }
});

test("WaveSpeed poll maps known states and rejects unknown states, identities and invalid completed outputs", async () => {
  const restore = fixtureEnv(); try {
    for (const [state, normalized] of Object.entries({ created: "queued", queued: "queued", processing: "running", running: "running", completed: "succeeded", failed: "failed", cancelled: "cancelled", timeout: "failed", deleted: "failed" })) {
      const provider = new WaveSpeedVideoProvider({ fetch: fetcher(async (url, init) => {
        assert.equal(url, `https://api.wavespeed.ai/api/v3/predictions/${id}/result`); assert.equal(init?.method, undefined);
        return json({ id, status: state, outputs: state === "completed" ? [output] : [], error: key });
      }) });
      const result = await provider.poll(id); assert.equal(result.status, normalized); assert.ok(!JSON.stringify(result).includes(key));
      if (state === "completed") assert.equal(result.outputUrl, output);
    }
    for (const data of [{ id, status: "surprise" }, { id, status: "constructor" }, { id, status: "__proto__" }, { id: "another", status: "completed", outputs: [output] }, { id, status: "completed", outputs: [] }, { id, status: "completed", outputs: [{ url: output }] }]) {
      await assert.rejects(new WaveSpeedVideoProvider({ fetch: fetcher(async () => json(data)) }).poll(id), ProviderSafeError);
    }
    for (const status of [429, 503]) await assert.rejects(new WaveSpeedVideoProvider({ fetch: fetcher(async () => new Response(key, { status })) }).poll(id), errorCode(status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE", true));
    const provider = new WaveSpeedVideoProvider({ fetch: fetcher(async () => { throw new Error(key); }) });
    await assert.rejects(provider.poll(id), errorCode("PROVIDER_UNAVAILABLE", true)); assert.equal(await provider.cancel(), false);
  } finally { restore(); }
});

test("output policy rejects arbitrary hosts, redirects, oversize downloads and unsupported MIME before private ingest", async () => {
  let calls = 0;
  const provider = new WaveSpeedVideoProvider({ fetch: fetcher(async () => { calls++; return new Response(bytes, { headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.length) } }); }) });
  for (const outputUrl of ["http://cdn.wavespeed.ai/a.mp4", "https://cdn.wavespeed.ai.evil.example/a.mp4", "https://random123.cloudfront.net/video.mp4", "https://127.0.0.1/a.mp4", "file:///video.mp4", "https://secret@cdn.wavespeed.ai/a.mp4", "https://cdn.wavespeed.ai:8443/a.mp4", "https://cdn.wavespeed.ai:443/a.mp4", "https://cdn.wavespeed.ai/a.mp4#fragment", "https://cdn.wavespeed.ai/a.mp4#", "https://d2h7xmz5gqybh9.cloudfront.net.evil.example/a.mp4"]) await assert.rejects(provider.retrieve({ status: "succeeded", outputUrl }), errorCode("OUTPUT_INVALID"));
  assert.equal(calls, 0);
  const result = await provider.retrieve({ status: "succeeded", outputUrl: output }); const chunks: Uint8Array[] = []; for await (const chunk of result.stream) chunks.push(chunk); assert.deepEqual(Buffer.concat(chunks), bytes);
  for (const response of [new Response(bytes, { headers: { "Content-Type": "text/html" } }), new Response(bytes, { headers: { "Content-Type": "video/mp4", "Content-Length": "9999999999" } })]) await assert.rejects(new WaveSpeedVideoProvider({ fetch: fetcher(async () => response) }).retrieve({ status: "succeeded", outputUrl: output }), errorCode("OUTPUT_INVALID"));
  await assert.rejects(new WaveSpeedVideoProvider({ fetch: fetcher(async (_url, init) => { assert.equal(init?.redirect, "manual"); return new Response("", { status: 302, headers: { Location: "https://d2h7xmz5gqybh9.cloudfront.net/redirect.mp4" } }); }) }).retrieve({ status: "succeeded", outputUrl: output }), errorCode("OUTPUT_UNAVAILABLE"));
});

test("the new authenticated Seedance CDN and both existing exact hosts remain accepted", async () => {
  for (const host of ["cdn.wavespeed.ai", "d2p7pge43lyniu.cloudfront.net", "d2h7xmz5gqybh9.cloudfront.net"]) {
    const outputUrl = `https://${host}/output/fixture.mp4?Expires=fixture`;
    assert.equal(waveSpeedOutputUrl(outputUrl).hostname, host);
    const provider = new WaveSpeedVideoProvider({ fetch: fetcher(async (url, init) => { assert.equal(url, outputUrl); assert.equal(init?.redirect, "manual"); assert.equal(init?.headers, undefined); return new Response(bytes, { headers: { "Content-Type": "video/mp4" } }); }) });
    const result = await provider.retrieve({ status: "succeeded", outputUrl });
    for await (const chunk of result.stream) assert.deepEqual(Buffer.from(chunk), bytes);
  }
});

test("private references require verified public HTTPS, adequate TTL, public DNS and matching signed bytes; never drop references", async () => {
  const restore = fixtureEnv(); try {
    const selected = { ...input, referenceAssetVersionIds: [id] };
    let posts = 0;
    const origin = "https://storage.example.com";
    function signed(ttl: number) { const url = new URL(origin + "/private/original"); for (const [k, v] of Object.entries({ "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Date": new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""), "X-Amz-Expires": String(ttl), "X-Amz-Signature": "fixture-signature" })) url.searchParams.set(k, v); return url.href; }
    const storage = { issueDownload: async (path: string, name: string, ttl: number) => { assert.equal(path, "private/original"); assert.equal(ttl, 3600); return signed(ttl); } } as ObjectStorage;
    const provider = new WaveSpeedVideoProvider({ storage: () => storage, resolve: async () => [{ address: "8.8.8.8", family: 4 }], fetch: fetcher(async (url, init) => {
      if (url.startsWith(origin)) { assert.equal(init?.redirect, "manual"); assert.equal(init?.headers, undefined); return new Response(bytes, { headers: { "Content-Type": "image/png" } }); }
      posts++; assert.equal(JSON.parse(String(init?.body)).reference_images[0], signed(3600)); return json({ id });
    }) });
    delete process.env.WAVESPEED_REFERENCE_FETCH_VERIFIED;
    await assert.rejects(provider.submit(selected, WAVESPEED_VIDEO_MODEL), errorCode("REFERENCE_UNAVAILABLE")); assert.equal(posts, 0);
    Object.assign(process.env, { WAVESPEED_REFERENCE_FETCH_VERIFIED: "1", OBJECT_STORAGE_PUBLIC_ENDPOINT: origin, WAVESPEED_REFERENCE_URL_TTL_SECONDS: "3600" });
    await provider.submit(selected, WAVESPEED_VIDEO_MODEL); assert.equal(posts, 1);
    for (const endpoint of ["http://127.0.0.1:9000", "https://localhost", "https://127.0.0.1", "https://storage.example.com/path"]) assert.throws(() => waveSpeedReferenceSettings({ ...process.env, OBJECT_STORAGE_PUBLIC_ENDPOINT: endpoint }));
    assert.throws(() => waveSpeedReferenceSettings({ ...process.env, WAVESPEED_REFERENCE_URL_TTL_SECONDS: "60" }));
    for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1"]) await assert.rejects(new WaveSpeedVideoProvider({ storage: () => storage, resolve: async () => [{ address, family: 4 }], fetch: fetcher(async () => { throw new Error("must not fetch"); }) }).referenceUrls(selected), errorCode("REFERENCE_UNAVAILABLE"));
    await assert.rejects(new WaveSpeedVideoProvider({ storage: () => storage, resolve: async () => [{ address: "8.8.8.8", family: 4 }], fetch: fetcher(async () => new Response("changed", { headers: { "Content-Type": "image/png" } })) }).referenceUrls(selected), errorCode("REFERENCE_UNAVAILABLE"));
    assert.equal(posts, 1);
  } finally { restore(); }
});

test("configuration selects independent video policies and worker analyzer credentials without leaking values", async () => {
  const restore = fixtureEnv(); try {
    assert.equal(videoConfigured(), true); process.env.WAVESPEED_VIDEO_BASE_URL = "https://evil.example"; assert.equal(videoConfigured(), false); delete process.env.WAVESPEED_VIDEO_BASE_URL;
    const queries: unknown[][] = [];
    const db = { query: async (_sql: string, params: unknown[]) => { queries.push(params); return { rows: [], rowCount: 0 }; } } as unknown as DbClient;
    await activeVideoPolicy(db); assert.deepEqual(queries[0], ["WAVESPEED", WAVESPEED_VIDEO_MODEL]);
    process.env.VIDEO_PROVIDER = "byteplus"; await activeVideoPolicy(db); assert.deepEqual(queries[1], ["BYTEPLUS", null]);
    Object.assign(process.env, { CLIP_ANALYZER_PROVIDER: "wavespeed", WAVESPEED_CLIP_MODEL: "openai/gpt-5.6-luna", ENABLE_FAKE_CLIP_ANALYZER: "1" });
    assert.equal(clipAnalyzerProvider(), "wavespeed"); assert.equal(clipperConfigured(), true);
    const sourceId="11111111-1111-4111-8111-111111111111";
    const request=clipperRequest({sourceAssetId:sourceId,idempotencyKey:"wavespeed-model-fixture",language:"en",goal:"Find complete useful ideas",targetClipCount:1,minClipSeconds:10,maxClipSeconds:30,captions:true});
    const frozen=prepareClipperInput(request,{id:sourceId,byte_size:"100",mime_type:"video/mp4",storage_key:"private-source",original_filename:"fixture.mp4",sha256:null} as SourceRow);
    assert.equal(frozen.analyzerProvider,"wavespeed");assert.equal(frozen.analyzerModel,"openai/gpt-5.6-luna");assert.ok(!JSON.stringify(frozen).includes(key));
    delete process.env.WAVESPEED_API_KEY; assert.equal(clipperConfigured(), false); process.env.CLIP_ANALYZER_WORKER_CREDENTIAL_CONFIGURED = "1"; assert.equal(clipperConfigured(), true);
    process.env.WAVESPEED_CLIP_MODEL = ""; assert.equal(clipperConfigured(), false);
    assert.equal(configurationChecks({ VIDEO_PROVIDER: "wavespeed" }).find(c => c.name === "WAVESPEED_API_KEY")?.status, "missing");
    assert.equal(configurationChecks({ CLIP_ANALYZER_PROVIDER: "wavespeed", WAVESPEED_CLIP_MODEL: "openai/gpt-5.6-luna", WAVESPEED_API_KEY: key, WAVESPEED_LLM_BASE_URL: "https://evil.example" }).find(c => c.name === "WAVESPEED_LLM_BASE_URL")?.status, "invalid");
    assert.ok(!JSON.stringify(externalConfiguration({ WAVESPEED_API_KEY: key })).includes(key));
    for (const value of ["http://api.wavespeed.ai", "https://api.wavespeed.ai/evil", "https://api.wavespeed.ai?token=secret"]) assert.throws(() => waveSpeedBase(value, "video"));
  } finally { restore(); }
});
