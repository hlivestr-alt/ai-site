import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { after, before, test } from "node:test";
import { authConfigured, createSession, destroySession, readSession, sameOrigin, SESSION_SECONDS, verifyPassword } from "./session";

const previousHash = process.env.AI_SITE_PASSWORD_HASH;
const previousSecret = process.env.AI_SITE_SESSION_SECRET;
before(() => {
  const salt = randomBytes(16);
  process.env.AI_SITE_PASSWORD_HASH = `scrypt:${salt.toString("hex")}:${scryptSync("valid-test-password", salt, 64).toString("hex")}`;
  process.env.AI_SITE_SESSION_SECRET = randomBytes(48).toString("base64url");
});
after(() => {
  if (previousHash === undefined) delete process.env.AI_SITE_PASSWORD_HASH; else process.env.AI_SITE_PASSWORD_HASH = previousHash;
  if (previousSecret === undefined) delete process.env.AI_SITE_SESSION_SECRET; else process.env.AI_SITE_SESSION_SECRET = previousSecret;
});

test("password hash and server session accept a valid login", async () => {
  assert.equal(authConfigured(), true);
  assert.equal(verifyPassword("valid-test-password"), true);
  assert.equal(verifyPassword("wrong-password"), false);
  const token = await createSession(1000);
  assert.deepEqual(await readSession(token, 2000), { user: "operator" });
  assert.equal(await readSession(`${token}x`, 2000), null);
  assert.equal(await readSession(token, 1000 + SESSION_SECONDS * 1000), null);
  const fresh = await createSession();
  await destroySession(fresh);
  assert.equal(await readSession(fresh), null);
});

test("missing configuration fails closed", async () => {
  const hash = process.env.AI_SITE_PASSWORD_HASH, secret = process.env.AI_SITE_SESSION_SECRET;
  delete process.env.AI_SITE_PASSWORD_HASH; delete process.env.AI_SITE_SESSION_SECRET;
  assert.equal(authConfigured(), false);
  assert.equal(verifyPassword("valid-test-password"), false);
  assert.equal(await readSession("anything"), null);
  process.env.AI_SITE_PASSWORD_HASH = hash; process.env.AI_SITE_SESSION_SECRET = secret;
});

test("write requests require an exact same-origin header", () => {
  assert.equal(sameOrigin(new Request("http://127.0.0.1:3100/api/test", { headers: { Origin: "http://127.0.0.1:3100" } })), true);
  assert.equal(sameOrigin(new Request("http://127.0.0.1:3100/api/test", { headers: { Origin: "https://other.example" } })), false);
  assert.equal(sameOrigin(new Request("http://127.0.0.1:3100/api/test")), false);
  // Next.js may normalize the request URL to localhost; Host retains the browser origin.
  assert.equal(sameOrigin(new Request("http://localhost:3100/api/test", { headers: { Host: "127.0.0.1:3100", Origin: "http://127.0.0.1:3100" } })), true);
  assert.equal(sameOrigin(new Request("http://localhost:3100/api/test", { headers: { Host: "127.0.0.1:3100", Origin: "http://localhost:3100" } })), false);
});
