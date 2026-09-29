import assert from "node:assert/strict";
import { test } from "node:test";
import { auditActor, auditRecord } from "./audit";
import { createSession, destroySession, SESSION_COOKIE } from "./auth/session";

test("audit allowlist drops secret fields and rejects arbitrary ID text", () => {
  const record = auditRecord("campaign.queue", "rejected", "unauthenticated", {
    campaignId: "11111111-1111-4111-8111-111111111111", count: 7,
    jobId: "secret\nforged log", password: "private", cookie: "private", token: "private", message: "private",
  } as Parameters<typeof auditRecord>[3]);
  assert.equal(record.count, 7);
  assert.equal(JSON.stringify(record).includes("private"), false);
  assert.equal(JSON.stringify(record).includes("secret"), false);
  assert.equal(auditRecord("h3.request", "attempt", "unauthenticated", { count: NaN }).count, undefined);
});

test("audit identity comes from actual session or local mode, never request claims", async () => {
  const prior = process.env.AUTH_ENABLED, priorSecret = process.env.AI_SITE_SESSION_SECRET;
  try {
    const request = new Request("http://127.0.0.1:3100", { headers: { "x-actor": "operator" } });
    process.env.AUTH_ENABLED = "false";
    assert.equal(await auditActor(request), "unauthenticated");
    process.env.AUTH_ENABLED = "true";
    process.env.AI_SITE_SESSION_SECRET = "isolated-audit-test-key-at-least-32-characters";
    assert.equal(await auditActor(request), "unauthenticated");
    const token = await createSession();
    try { assert.equal(await auditActor(new Request(request, { headers: { cookie: `${SESSION_COOKIE}=${token}` } })), "operator"); }
    finally { await destroySession(token); }
  } finally {
    if (prior === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prior;
    if (priorSecret === undefined) delete process.env.AI_SITE_SESSION_SECRET; else process.env.AI_SITE_SESSION_SECRET = priorSecret;
  }
});
