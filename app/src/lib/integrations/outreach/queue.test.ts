import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmAndQueueCampaign, getConfirmationSummary, mapConfirmation, QueueError } from "./queue";

const id = "11111111-1111-4111-8111-111111111111";
function campaign(overrides: Record<string, unknown> = {}) {
  return { id, name: "20260925_001", state: "FROZEN", version: 4, targetCount: 10, messageTemplate: "Hello {{creator_display_name}}", frozenTemplate: "Hello {{creator_display_name}}", filters: { minFollowers: 1000 }, frozenFilters: { minFollowers: 1000, cooldownDays: 30 }, freezeExpiresAt: new Date(Date.now() + 600_000).toISOString(), progress: { frozen: 7, remaining: 7 }, outboundEnabled: true, outboundCapability: { mode: "LIVE", available: true, workerState: "RUNNING" }, shop: { shopCipher: "secret" }, ...overrides };
}
function withFlag<T>(value: string | undefined, run: () => Promise<T>) {
  const prior = process.env.OUTREACH_QUEUE_ENABLED;
  const priorAuth = process.env.AUTH_ENABLED;
  process.env.AUTH_ENABLED = "true";
  if (value === undefined) delete process.env.OUTREACH_QUEUE_ENABLED; else process.env.OUTREACH_QUEUE_ENABLED = value;
  return run().finally(() => {
    if (prior === undefined) delete process.env.OUTREACH_QUEUE_ENABLED; else process.env.OUTREACH_QUEUE_ENABLED = prior;
    if (priorAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = priorAuth;
  });
}

test("confirmation mapping exposes only a narrow summary", () => {
  const summary = mapConfirmation(campaign());
  assert.equal(summary.frozen, 7);
  assert.equal(summary.estimatedMessages, 7);
  assert.equal(summary.filters.cooldownDays, 30);
  assert.equal(JSON.stringify(summary).includes("secret"), false);
});

test("feature gate defaults off and prevents all native requests", async () => withFlag(undefined, async () => {
  let calls = 0; const fetcher = (async () => { calls++; return Response.json(campaign()); }) as typeof fetch;
  await assert.rejects(() => confirmAndQueueCampaign(id, 4, fetcher), (error: unknown) => error instanceof QueueError && error.status === 503);
  assert.equal(calls, 0);
}));

test("enabled queue rechecks native frozen state and sends only version", async () => withFlag("true", async () => {
  let posts = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    assert.match(url, new RegExp(id));
    if (init?.method === "POST") {
      posts++;
      assert.ok(url.endsWith(`/${id}/send`));
      assert.deepEqual(JSON.parse(String(init.body)), { version: 4 });
      return Response.json(campaign({ state: "QUEUED", version: 5 }));
    }
    return Response.json(campaign());
  }) as typeof fetch;
  const result = await confirmAndQueueCampaign(id, 4, fetcher);
  assert.equal(result.campaign.state, "QUEUED"); assert.equal(result.alreadyQueued, false); assert.equal(posts, 1);
}));

test("stale, empty, and offline sender states never call send", async () => withFlag("true", async () => {
  for (const [native, version, message] of [
    [campaign(), 3, /changed/],
    [campaign({ progress: { frozen: 0 } }), 4, /No frozen/],
    [campaign({ outboundEnabled: false }), 4, /sender is unavailable/],
    [campaign({ state: "CANCELLED" }), 4, /not frozen/],
    [campaign({ freezeExpiresAt: "invalid" }), 4, /expired/],
    [campaign({ freezeExpiresAt: new Date(0).toISOString() }), 4, /expired/],
    [campaign({ freezeExpiresAt: null }), 4, /expired/],
  ] as const) {
    let posts = 0;
    const fetcher = (async (_url: string, init?: RequestInit) => { if (init?.method === "POST") posts++; return Response.json(native); }) as typeof fetch;
    await assert.rejects(() => confirmAndQueueCampaign(id, version, fetcher), message);
    assert.equal(posts, 0);
  }
}));

test("auth-disabled queue remains available when its gate is true", async () => withFlag("true", async () => {
  process.env.AUTH_ENABLED = "false";
  let posts = 0;
  const fetcher = (async (url: string, init?: RequestInit) => {
    assert.ok(url.startsWith("http://127.0.0.1:4000/api/v1/outreach/campaigns/"));
    if (init?.method === "POST") { posts++; return Response.json(campaign({ state: "QUEUED", version: 5 })); }
    return Response.json(campaign());
  }) as typeof fetch;
  assert.equal(mapConfirmation(campaign()).queueEnabled, true);
  const result = await confirmAndQueueCampaign(id, 4, fetcher);
  assert.equal(result.campaign.state, "QUEUED");
  assert.equal(posts, 1);
}));

test("HTTP confirmation ignores client gate, URL, credentials and sender claims without login", async () => withFlag("true", async () => {
  process.env.AUTH_ENABLED = "false";
  const priorFetch = globalThis.fetch;
  let reads = 0, posts = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    assert.ok(url.startsWith("http://127.0.0.1:4000/api/v1/outreach/campaigns/"));
    if (init?.method === "POST") {
      posts++;
      assert.deepEqual(JSON.parse(String(init.body)), { version: 4 });
      return Response.json(campaign({ state: "QUEUED", version: 5 }));
    }
    reads++;
    return Response.json(campaign());
  }) as typeof fetch;
  try {
    const { POST } = await import("../../../app/api/outreach/campaigns/[id]/confirm/route");
    const response = await POST(new Request("http://127.0.0.1:3100/api/outreach/campaigns/" + id + "/confirm", {
      method: "POST", headers: { Origin: "http://127.0.0.1:3100", "Content-Type": "application/json" },
      body: JSON.stringify({ version: 4, confirm: true, AUTH_ENABLED: true, OUTREACH_QUEUE_ENABLED: true, nativeUrl: "https://other.invalid", credentials: "private", senderAvailable: true }),
    }), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).campaign.state, "QUEUED");
    assert.equal(reads, 1);
    assert.equal(posts, 1);
  } finally { globalThis.fetch = priorFetch; }
}));

test("different concurrent versions cannot bypass authoritative stale-version validation", async () => withFlag("true", async () => {
  let posts = 0;
  const fetcher = (async (_url: string, init?: RequestInit) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    if (init?.method === "POST") { posts++; return Response.json(campaign({ state: "QUEUED", version: 5 })); }
    return Response.json(campaign());
  }) as typeof fetch;
  const results = await Promise.allSettled([confirmAndQueueCampaign(id, 4, fetcher), confirmAndQueueCampaign(id, 3, fetcher)]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(posts, 1);
}));

test("uncertain native failure is not retried; repeat confirmation uses native queued state", async () => withFlag("true", async () => {
  let posts = 0;
  let queued = false;
  const fetcher = (async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posts++; queued = true; throw new Error("private native error"); }
    return Response.json(campaign(queued ? { state: "QUEUED", version: 5 } : {}));
  }) as typeof fetch;
  await assert.rejects(() => confirmAndQueueCampaign(id, 4, fetcher), /uncertain/);
  assert.equal((await confirmAndQueueCampaign(id, 4, fetcher)).alreadyQueued, true);
  assert.equal(posts, 1);
}));

test("already queued returns authoritative state without a second POST", async () => withFlag("true", async () => {
  let posts = 0;
  const fetcher = (async (_url: string, init?: RequestInit) => { if (init?.method === "POST") posts++; return Response.json(campaign({ state: "RUNNING", version: 5 })); }) as typeof fetch;
  assert.equal((await confirmAndQueueCampaign(id, 4, fetcher)).alreadyQueued, true);
  assert.equal(posts, 0);
}));

test("concurrent server requests share one native queue operation", async () => withFlag("true", async () => {
  let posts = 0;
  const fetcher = (async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posts++; await new Promise(resolve => setTimeout(resolve, 20)); return Response.json(campaign({ state: "QUEUED", version: 5 })); }
    return Response.json(campaign());
  }) as typeof fetch;
  const [first, second] = await Promise.all([confirmAndQueueCampaign(id, 4, fetcher), confirmAndQueueCampaign(id, 4, fetcher)]);
  assert.equal(first.campaign.state, "QUEUED"); assert.equal(second.campaign.state, "QUEUED"); assert.equal(posts, 1);
}));

test("offline backend and queue rejection are sanitized", async () => withFlag("true", async () => {
  await assert.rejects(() => confirmAndQueueCampaign(id, 4, (async () => { throw new Error("private connection string"); }) as typeof fetch), /backend is unavailable/);
  const fetcher = (async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Response("private details", { status: 409 }) : Response.json(campaign())) as typeof fetch;
  await assert.rejects(() => confirmAndQueueCampaign(id, 4, fetcher), /Refresh the campaign state/);
  assert.equal((await getConfirmationSummary(id, (async () => Response.json(campaign())) as typeof fetch)).id, id);
}));

test("malformed native JSON never echoes native payload or retries a queue", async () => withFlag("true", async () => {
  const bad = () => new Response('private-token={"broken":');
  await assert.rejects(() => getConfirmationSummary(id, (async () => bad()) as typeof fetch), (error: unknown) => error instanceof QueueError && !error.message.includes("private-token"));
  let posts = 0;
  const fetcher = (async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { posts++; return bad(); }
    return Response.json(campaign());
  }) as typeof fetch;
  await assert.rejects(() => confirmAndQueueCampaign(id, 4, fetcher), (error: unknown) => error instanceof QueueError && !error.message.includes("private-token"));
  assert.equal(posts, 1);
}));
