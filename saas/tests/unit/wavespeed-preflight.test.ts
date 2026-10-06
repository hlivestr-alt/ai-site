import { test } from "node:test";
import assert from "node:assert/strict";
import { waveSpeedLivePreflight, waveSpeedSmokePayload } from "../../src/lib/wavespeed-preflight";
import { WAVESPEED_VIDEO_MODEL } from "../../src/lib/wavespeed-config";
const key = "preflight-unit-fixture-secret", model = "openai/gpt-5.6-luna";
const env = { WAVESPEED_API_KEY: key, WAVESPEED_CLIP_MODEL: model };

async function modelAvailability(catalog: unknown, exact: () => Response | Promise<Response>, catalogStatus = 200, configuredModel = model) {
  const calls: { url: string; method: string }[] = [];
  const result = await waveSpeedLivePreflight({ ...env, WAVESPEED_CLIP_MODEL: configuredModel }, (async (url, init) => {
    const value = String(url), method = init?.method || "GET"; calls.push({ url: value, method });
    assert.equal(init?.redirect, "manual"); assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${key}`);
    assert.ok(!value.includes(key));
    if (value.startsWith("https://llm.wavespeed.ai/v1/")) {
      assert.equal(method, "GET"); assert.equal(init?.body, undefined);
      if (value === "https://llm.wavespeed.ai/v1/models") return Response.json(catalog, { status: catalogStatus });
      assert.equal(value, `https://llm.wavespeed.ai/v1/models/${configuredModel.split("/").map(encodeURIComponent).join("/")}`);
      return exact();
    }
    if (value.endsWith("/balance")) return Response.json({ code: 200, data: { balance: 10 } });
    if (value.endsWith("/models")) return Response.json({ code: 200, data: [{ model_id: WAVESPEED_VIDEO_MODEL }] });
    assert.equal(value, "https://api.wavespeed.ai/api/v3/model/price"); assert.equal(method, "POST");
    return Response.json({ code: 200, data: { model_id: WAVESPEED_VIDEO_MODEL, price: 1.44, discounted_price: 1.44, currency: "USD" } });
  }) as typeof fetch);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.ok(calls.every(call => call.method === "GET" || call.url === "https://api.wavespeed.ai/api/v3/model/price"));
  return { result, calls: calls.filter(call => call.url.startsWith("https://llm.wavespeed.ai/")) };
}

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

test("a usable authenticated list determines exact model availability without another lookup", async () => {
  for (const [data, status] of [[[{ id: model }], "AVAILABLE"], [[{ id: "openai/gpt-5.6-sol" }], "MODEL_NOT_AVAILABLE"], [[], "MODEL_NOT_AVAILABLE"]] as const) {
    const { result, calls } = await modelAvailability({ object: "list", data }, () => { throw new Error("Exact lookup must not occur"); });
    assert.equal(result.llmModel.status, status); assert.equal(calls.length, 1);
  }
});

test("an authenticated null or unusable catalog falls back to the exact authenticated model GET", async () => {
  for (const catalog of [{ object: "list", data: null }, { data: {} }, { data: [null] }, {}, null]) {
    for (const exact of [{ id: model, object: "model" }, { id: model }]) {
      const { result, calls } = await modelAvailability(catalog, () => Response.json(exact));
      assert.equal(result.llmModel.status, "AVAILABLE"); assert.equal(result.ready, true);
      assert.deepEqual(calls, [{ url: "https://llm.wavespeed.ai/v1/models", method: "GET" }, { url: `https://llm.wavespeed.ai/v1/models/${model}`, method: "GET" }]);
    }
  }
});

test("exact-model HTTP failures remain unavailable and sanitize provider errors", async () => {
  for (const [httpStatus, status] of [[401, "AUTHENTICATION_FAILED"], [403, "PERMISSION_DENIED"], [404, "MODEL_NOT_AVAILABLE"], [429, "RATE_LIMITED"], [500, "UNAVAILABLE"], [503, "UNAVAILABLE"], [302, "HTTP_ERROR"]] as const) {
    const { result, calls } = await modelAvailability({ data: null }, () => new Response(key, { status: httpStatus }));
    assert.equal(result.llmModel.status, status); assert.equal(result.ready, false); assert.equal(calls.length, 2);
  }
  const { result, calls } = await modelAvailability({ data: null }, () => { throw new Error(key); });
  assert.equal(result.llmModel.status, "UNAVAILABLE"); assert.equal(result.ready, false); assert.equal(calls.length, 2);
});

test("an exact-model mismatch never substitutes the returned model", async () => {
  const { result } = await modelAvailability({ data: null }, () => Response.json({ id: "openai/gpt-5.6-sol", object: "model", description: key }));
  assert.equal(result.llmModel.status, "MODEL_NOT_AVAILABLE"); assert.equal(result.llmModel.modelId, model); assert.equal(result.ready, false);
});

test("malformed or non-200 exact-model responses cannot prove account access", async () => {
  for (const body of [null, [], "model", {}, { id: null }, { id: 1 }, { id: model, object: "list" }, { id: model, object: null }, { id: model, code: 401 }]) {
    const { result } = await modelAvailability({ data: null }, () => Response.json(body));
    assert.equal(result.llmModel.status, "INVALID_RESPONSE"); assert.equal(result.ready, false);
  }
  const malformed = await modelAvailability({ data: null }, () => new Response("{"));
  assert.equal(malformed.result.llmModel.status, "UNAVAILABLE"); assert.equal(malformed.result.ready, false);
  const non200 = await modelAvailability({ data: null }, () => Response.json({ id: model, object: "model" }, { status: 201 }));
  assert.equal(non200.result.llmModel.status, "INVALID_RESPONSE"); assert.equal(non200.result.ready, false);
});

test("a failed authenticated list is never replaced by another catalog or exact lookup", async () => {
  for (const [httpStatus, status] of [[401, "AUTHENTICATION_FAILED"], [403, "PERMISSION_DENIED"], [404, "MODEL_NOT_AVAILABLE"], [429, "RATE_LIMITED"], [503, "UNAVAILABLE"], [302, "HTTP_ERROR"], [201, "INVALID_RESPONSE"]] as const) {
    const { result, calls } = await modelAvailability({ data: null }, () => { throw new Error("Fallback must not occur"); }, httpStatus);
    assert.equal(result.llmModel.status, status); assert.equal(calls.length, 1); assert.equal(result.ready, false);
  }
});

test("invalid configured model IDs never enter an authenticated lookup path", async () => {
  for (const configuredModel of ["openai/../model", "openai/model?key=secret", "openai/model#fragment", "openai/model/extra", "openai/model%2Fextra"]) {
    const { result, calls } = await modelAvailability({ data: null }, () => { throw new Error("Lookup must not occur"); }, 200, configuredModel);
    assert.equal(result.llmModel.status, "MISSING_OR_INVALID_WAVESPEED_CLIP_MODEL"); assert.equal(calls.length, 0);
  }
});
