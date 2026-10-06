import { test } from "node:test";
import assert from "node:assert/strict";
import { assertStorageCredentials, storageGatewayConfig } from "../../docker/storage-gateway-config.mjs";
import { configurationChecks } from "../../src/lib/operational-config";
import { storageClient, storageSigningClient } from "../../src/lib/storage";

test("equal public storage identifier and signing secret are rejected at every boundary", () => {
  const fixture = { APP_ENV: "test", OBJECT_STORAGE_ACCESS_KEY: "synthetic-equal-pair", OBJECT_STORAGE_SECRET_KEY: "synthetic-equal-pair" };
  assert.throws(() => assertStorageCredentials(fixture), /must be distinct/);
  assert.throws(() => storageGatewayConfig(fixture), /must be distinct/);
  assert.equal(configurationChecks(fixture).find(c => c.name === "OBJECT_STORAGE_SECRET_KEY")?.status, "invalid");
  const saved = { ...process.env };
  try {
    Object.assign(process.env, fixture, { OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000", OBJECT_STORAGE_REGION: "us-east-1" });
    assert.throws(() => storageClient(), /must be distinct/);
    assert.throws(() => storageSigningClient(), /must be distinct/);
  } finally { process.env = saved; }
});

test("a distinct identifier and secret pass without disclosing either in errors", () => {
  assert.doesNotThrow(() => assertStorageCredentials({ OBJECT_STORAGE_ACCESS_KEY: "synthetic-public-id", OBJECT_STORAGE_SECRET_KEY: "synthetic-private-secret" }));
  const equal = "synthetic-equal-pair";
  assert.throws(() => assertStorageCredentials({ OBJECT_STORAGE_ACCESS_KEY: equal, OBJECT_STORAGE_SECRET_KEY: equal }), e => e instanceof Error && !e.message.includes(equal));
});
