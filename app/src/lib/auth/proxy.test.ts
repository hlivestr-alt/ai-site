import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { after, before, test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../../proxy";
import { POST as login } from "../../app/api/auth/login/route";
import { POST as logout } from "../../app/api/auth/logout/route";
import { createSession, destroySession, readSession, SESSION_COOKIE, SESSION_SECONDS } from "./session";

const oldHash = process.env.AI_SITE_PASSWORD_HASH, oldSecret = process.env.AI_SITE_SESSION_SECRET;
const oldEnabled = process.env.AUTH_ENABLED;
before(() => {
  process.env.AUTH_ENABLED = "true";
  const salt = randomBytes(16);
  process.env.AI_SITE_PASSWORD_HASH = `scrypt:${salt.toString("hex")}:${scryptSync("correct-test-password", salt, 64).toString("hex")}`;
  process.env.AI_SITE_SESSION_SECRET = randomBytes(48).toString("base64url");
});
after(() => {
  if (oldEnabled === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = oldEnabled;
  if (oldHash === undefined) delete process.env.AI_SITE_PASSWORD_HASH; else process.env.AI_SITE_PASSWORD_HASH = oldHash;
  if (oldSecret === undefined) delete process.env.AI_SITE_SESSION_SECRET; else process.env.AI_SITE_SESSION_SECRET = oldSecret;
});

test("local mode opens all pages and API reads without a session, and redirects login", async () => {
  process.env.AUTH_ENABLED = "false";
  try {
    for (const path of ["/", "/ai-videos", "/clipper", "/outreach", "/settings", "/api/auth/session", "/api/ai-video/jobs", "/api/clipper/overview", "/api/outreach/overview"]) {
      const response = await proxy(request(path, "invalid"));
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    }
    const response = await proxy(request("/login"));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), new URL("/", request("/login").url).href);
    const { GET } = await import("../../app/api/auth/session/route");
    assert.deepEqual(await (await GET()).json(), { user: null, authEnabled: false });
    const responseLogin = await login(request("/api/auth/login", undefined, "POST"));
    assert.deepEqual(await responseLogin.json(), { user: null, authEnabled: false });
    assert.equal(responseLogin.headers.get("set-cookie"), null);
  } finally { process.env.AUTH_ENABLED = "true"; }
});

test("local mode still rejects missing and foreign origins on every platform write", async () => {
  process.env.AUTH_ENABLED = "false";
  try {
    for (const path of ["/api/ai-video/jobs", "/api/ai-video/jobs/test", "/api/outreach/draft", "/api/outreach/campaigns/test/discover", "/api/outreach/campaigns/test/freeze", "/api/outreach/campaigns/test/confirm", "/api/auth/logout"]) {
      for (const method of ["POST", "PATCH", "DELETE"]) {
        assert.equal((await proxy(request(path, undefined, method))).status, 200, `${method} ${path}`);
        assert.equal((await proxy(request(path, undefined, method, "https://other.example"))).status, 403);
        assert.equal((await proxy(new NextRequest(`http://127.0.0.1:3100${path}`, { method }))).status, 403);
      }
    }
  } finally { process.env.AUTH_ENABLED = "true"; }
});

function request(path: string, token?: string, method = "GET", origin = "http://127.0.0.1:3100") {
  return new NextRequest(`http://127.0.0.1:3100${path}`, { method, headers: { host: "127.0.0.1:3100", ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}), ...(method === "GET" ? {} : { origin }) } });
}

test("pages redirect, APIs reject, and valid sessions pass", async () => {
  assert.equal((await proxy(request("/ai-videos"))).status, 307);
  assert.equal((await proxy(request("/api/outreach/overview"))).status, 401);
  const token = await createSession();
  assert.equal((await proxy(request("/ai-videos", token))).status, 200);
  assert.equal((await proxy(request("/api/outreach/overview", token))).status, 200);
  assert.equal((await proxy(request("/outreach", "invalid"))).status, 307);
  assert.equal((await proxy(request("/login", token))).status, 307);
  await destroySession(token);
});

test("cross-origin mutations are rejected even with a session", async () => {
  const token = await createSession();
  assert.equal((await proxy(request("/api/ai-video/jobs", token, "POST", "https://other.example"))).status, 403);
  assert.equal((await proxy(request("/api/outreach/campaigns/11111111-1111-4111-8111-111111111111/confirm", token, "POST", "https://other.example"))).status, 403);
  assert.equal((await proxy(request("/api/outreach/draft", token, "POST"))).status, 200);
  await destroySession(token);
});

test("expired sessions cannot reach campaign confirmation", async () => {
  const token = await createSession(Date.now() - (SESSION_SECONDS + 1) * 1000);
  const response = await proxy(request("/api/outreach/campaigns/11111111-1111-4111-8111-111111111111/confirm", token, "POST"));
  assert.equal(response.status, 401);
  assert.equal(await readSession(token), null);
});

test("login sets HttpOnly session, invalid password is rejected, and logout clears it", async () => {
  const bad = await login(new NextRequest("http://127.0.0.1:3100/api/auth/login", { method: "POST", headers: { origin: "http://127.0.0.1:3100", "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) }));
  assert.equal(bad.status, 401);
  const good = await login(new NextRequest("http://127.0.0.1:3100/api/auth/login", { method: "POST", headers: { origin: "http://127.0.0.1:3100", "content-type": "application/json" }, body: JSON.stringify({ password: "correct-test-password" }) }));
  assert.equal(good.status, 200);
  assert.match(good.headers.get("set-cookie") || "", /HttpOnly/i);
  assert.match(good.headers.get("set-cookie") || "", /SameSite=strict/i);
  const token = good.cookies.get(SESSION_COOKIE)?.value;
  assert.deepEqual(await readSession(token), { user: "operator" });
  const out = await logout(request("/api/auth/logout", token, "POST"));
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie") || "", /Max-Age=0/i);
  assert.equal(await readSession(token), null);
});
