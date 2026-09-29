import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, validPassword, hashPassword, verifyPassword, hashToken, randomToken, safeNext, role } from "../../src/lib/core";
import { can } from "../../src/lib/permissions";

test("normalizes identity and rejects malformed input",()=>{
  assert.equal(normalizeEmail("  A@Example.com "),"a@example.com");
  assert.throws(()=>normalizeEmail("invalid"));
  assert.throws(()=>validPassword("short"));
  assert.equal(validPassword("correct-horse-123"),"correct-horse-123");
  assert.equal(safeNext("https://evil.test"),"/");
  assert.equal(safeNext("/invite?token="+"x".repeat(32)),"/invite?token="+"x".repeat(32));
  assert.throws(()=>role("BILLING"));
});

test("password and bearer tokens are never persisted in plaintext",async()=>{
  const raw="correct-horse-123",encoded=await hashPassword(raw);
  assert.ok(!encoded.includes(raw));
  assert.ok(await verifyPassword(raw,encoded));
  assert.equal(await verifyPassword("wrong-password-123",encoded),false);
  const token=randomToken();
  assert.notEqual(token,hashToken(token));
  assert.equal(hashToken(token).length,64);
});

test("role matrix reserves membership and billing for privileged roles",()=>{
  for (const permission of ["workspace:read","team:read"] as const) for(const r of ["OWNER","ADMIN","EDITOR","VIEWER"] as const) assert.equal(can(r,permission),true);
  assert.equal(can("OWNER","future:billing"),true);
  assert.equal(can("ADMIN","future:billing"),false);
  assert.equal(can("ADMIN","team:manage"),true);
  assert.equal(can("EDITOR","team:manage"),false);
  assert.equal(can("EDITOR","future:edit"),true);
  assert.equal(can("VIEWER","future:edit"),false);
  assert.equal(can("VIEWER","future:spend"),false);
});
