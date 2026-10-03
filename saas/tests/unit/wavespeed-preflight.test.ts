import { test } from "node:test";
import assert from "node:assert/strict";
import { waveSpeedLivePreflight, waveSpeedSmokePayload } from "../../src/lib/wavespeed-preflight";
import { WAVESPEED_VIDEO_MODEL } from "../../src/lib/wavespeed-config";
const key = "preflight-unit-fixture-secret", model = "openai/gpt-5.6-luna";
const env = { WAVESPEED_API_KEY: key, WAVESPEED_CLIP_MODEL: model };

test("live preflight authenticates account, confirms exact catalogs and estimates four-second price without inference", async () => {
  const calls: string[] = [];
  const result = await waveSpeedLivePreflight(env, (async (url, init) => {
    const value = String(url); calls.push(value); assert.equal(init?.redirect, "manual");
    assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${key}`);
    if (value.endsWith("/balance")) return Response.json({ code: 200, data: { balance: 10 } });
    if (value === "https://llm.wavespeed.ai/v1/models") return Response.json({ data: [{ id: model }] });
    if (value.endsWith("/models")) return Response.json({ code: 200, data: [{ model_id: WAVESPEED_VIDEO_MODEL }] });
    assert.ok(value.endsWith("/model/price")); assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { model_id: WAVESPEED_VIDEO_MODEL, inputs: waveSpeedSmokePayload });
    return Response.json({ code: 200, data: { model_id: WAVESPEED_VIDEO_MODEL, price: 1.44, discounted_price: 1.296, currency: "USD" } });
  }) as typeof fetch);
  assert.equal(result.ready, true); assert.equal(result.videoEstimate.amountUsd, 1.296); assert.equal(calls.length, 4);
  assert.ok(!JSON.stringify(result).includes(key)); assert.ok(calls.every(url => !url.endsWith("/text-to-video")));
});

test("missing key, unavailable configured model, incorrect quote and provider failures fail closed without fallback", async () => {
  let calls = 0;
  const missing = await waveSpeedLivePreflight({}, (async () => { calls++; throw new Error(key); }) as typeof fetch);
  assert.equal(calls, 0); assert.equal(missing.authentication.status, "MISSING_WAVESPEED_API_KEY");
  const invalidModel = await waveSpeedLivePreflight({ WAVESPEED_CLIP_MODEL: "invalid secret configuration" });
  assert.equal(invalidModel.llmModel.modelId, undefined);
  for (const status of [401, 429, 503]) {
    const result = await waveSpeedLivePreflight(env, (async () => new Response(key, { status })) as typeof fetch);
    assert.equal(result.ready, false); assert.ok(!JSON.stringify(result).includes(key));
  }
  const wrong = await waveSpeedLivePreflight(env, (async url => String(url).endsWith("/balance") ? Response.json({ data: { balance: 10 } }) : Response.json({ data: [{ id: "openai/gpt-5.6-sol", model_id: "another-video" }] })) as typeof fetch);
  assert.equal(wrong.llmModel.status, "MODEL_NOT_AVAILABLE"); assert.equal(wrong.videoModel.status, "MODEL_NOT_AVAILABLE"); assert.equal(wrong.videoEstimate.status, "NOT_CHECKED");
});
