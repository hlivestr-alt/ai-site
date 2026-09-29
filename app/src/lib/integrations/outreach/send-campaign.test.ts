import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileOperations, sendCampaign, type NativeSnapshot, type OperationStore, type SendDependencies, type SendOperation } from "./send-campaign";
import type { ConfirmationSummary } from "./queue";

const id = "11111111-1111-4111-8111-111111111111";
const input = { messageTemplate: "Hello {{creator_display_name}}", targetCount: 10, cooldownDays: 30, rankingMetric: "FOLLOWERS", filters: { minFollowers: 1000 } };
function fixture() {
  const records = new Map<string, SendOperation>();
  const calls = { create: 0, discover: 0, freeze: 0, queue: 0 };
  let state = "DRAFT", selected = 3, frozen = 0, senderAvailable = true;
  let failAt: keyof typeof calls | null = null;
  const store: OperationStore = {
    read: async key => records.get(key) ?? null,
    create: async operation => { if (records.has(operation.key)) return false; records.set(operation.key, operation); return true; },
    save: async operation => { records.set(operation.key, operation); },
  };
  const campaign = (): ConfirmationSummary => ({
    id, state, version: state === "DRAFT" ? 1 : state === "PREVIEW_READY" ? 2 : state === "FROZEN" ? 3 : 4,
    message: input.messageTemplate, targetCount: 10, frozen, estimatedMessages: frozen, freezeExpiresAt: "2099-01-01T00:00:00Z",
    filters: input.filters, senderAvailable, queueEnabled: true,
  });
  const deps: SendDependencies = {
    enabled: () => true,
    create: async () => { calls.create++; if (failAt === "create") throw new Error("create failed"); state = "DRAFT"; return { id }; },
    discover: async () => { calls.discover++; if (failAt === "discover") throw new Error("preview failed"); state = "PREVIEW_READY"; },
    freeze: async () => { calls.freeze++; if (failAt === "freeze") throw new Error("freeze failed"); state = "FROZEN"; frozen = selected; },
    snapshot: async (): Promise<NativeSnapshot> => ({ campaign: campaign(), selected }),
    queue: async () => { calls.queue++; if (!senderAvailable) throw new Error("The native Outreach sender is unavailable."); if (failAt === "queue") throw new Error("queue rejected"); state = "QUEUED"; },
  };
  return { store, deps, calls, setSelected: (value: number) => { selected = value; }, setSender: (value: boolean) => { senderAvailable = value; }, setFailure: (value: keyof typeof calls | null) => { failAt = value; }, getState: () => state };
}
async function advance(f: ReturnType<typeof fixture>, key: string, retry = false) {
  return sendCampaign(key, undefined, retry, f.deps, f.store);
}
async function untilStopped(f: ReturnType<typeof fixture>, key: string) {
  let result: SendOperation | undefined;
  for (let i = 0; i < 5; i++) {
    result = await advance(f, key);
    if (["sending", "failed", "uncertain"].includes(result.stage)) return result;
  }
  throw new Error("Operation did not settle");
}

test("one action runs native create, preview, freeze, queue and records actual frozen count", async () => {
  const f = fixture(), key = randomUUID();
  const first = await sendCampaign(key, input, false, f.deps, f.store);
  assert.equal(first.stage, "selecting");
  assert.equal((await advance(f, key)).stage, "freezing");
  assert.equal((await advance(f, key)).stage, "queueing");
  const result = await advance(f, key);
  assert.equal(result.stage, "sending"); assert.equal(result.frozen, 3);
  assert.deepEqual(f.calls, { create: 1, discover: 1, freeze: 1, queue: 1 });
});

test("double click, repeated POST, and refresh reuse one native campaign and send", async () => {
  const f = fixture(), key = randomUUID();
  const results = await Promise.all([sendCampaign(key, input, false, f.deps, f.store), sendCampaign(key, input, false, f.deps, f.store)]);
  assert.deepEqual(results.map(item => item.campaignId), [id, id]);
  await untilStopped(f, key);
  await advance(f, key); await advance(f, key, true);
  assert.equal(f.calls.create, 1); assert.equal(f.calls.queue, 1);
});

test("zero recipients stops before freeze or queue", async () => {
  const f = fixture(), key = randomUUID(); f.setSelected(0);
  await sendCampaign(key, input, false, f.deps, f.store);
  const result = await untilStopped(f, key);
  assert.equal(result.error, "No eligible creators matched this campaign.");
  assert.equal(f.calls.freeze, 0); assert.equal(f.calls.queue, 0);
});

for (const stage of ["discover", "freeze", "queue"] as const) {
  test(`${stage} failure stops and retry continues the same campaign`, async () => {
    const f = fixture(), key = randomUUID(); f.setFailure(stage);
    await sendCampaign(key, input, false, f.deps, f.store);
    const failed = await untilStopped(f, key);
    assert.equal(failed.stage, "failed"); assert.equal(failed.campaignId, id);
    assert.equal(f.calls.create, 1);
    if (stage === "discover") { assert.equal(f.calls.freeze, 0); assert.equal(f.calls.queue, 0); }
    if (stage === "freeze") assert.equal(f.calls.queue, 0);
    assert.equal((await advance(f, key)).stage, "failed");
    f.setFailure(null);
    await advance(f, key, true);
    const finished = await untilStopped(f, key);
    assert.equal(finished.stage, "sending");
    assert.equal(f.calls.create, 1); assert.equal(f.calls.queue, 1 + Number(stage === "queue"));
  });
}

test("unavailable sender never queues and can resume the frozen campaign", async () => {
  const f = fixture(), key = randomUUID(); f.setSender(false);
  await sendCampaign(key, input, false, f.deps, f.store);
  const failed = await untilStopped(f, key);
  assert.equal(failed.stage, "failed"); assert.equal(f.getState(), "FROZEN");
  assert.equal(f.calls.queue, 0);
  f.setSender(true);
  assert.equal((await advance(f, key, true)).stage, "sending");
  assert.equal(f.calls.create, 1);
});

test("uncertain native creation never makes a second create attempt", async () => {
  const f = fixture(), key = randomUUID(); f.setFailure("create");
  const result = await sendCampaign(key, input, false, f.deps, f.store);
  assert.equal(result.stage, "uncertain");
  f.setFailure(null); await advance(f, key, true);
  assert.equal(f.calls.create, 1); assert.equal(f.calls.queue, 0);
});

test("same operation key cannot be reused with changed campaign content", async () => {
  const f = fixture(), key = randomUUID();
  await sendCampaign(key, input, false, f.deps, f.store);
  await assert.rejects(() => sendCampaign(key, { ...input, targetCount: 20 }, false, f.deps, f.store), /different campaign details/);
  assert.equal(f.calls.create, 1);
});

test("operation journal survives a new read and cannot be created twice", async () => {
  const key = randomUUID();
  const path = resolve(process.cwd(), "data", "outreach-operations", `${key}.json`);
  try {
    const initial: SendOperation = { key, inputHash: "test", stage: "creating" };
    assert.equal(await fileOperations.create(initial), true);
    assert.equal(await fileOperations.create(initial), false);
    const saved: SendOperation = { ...initial, campaignId: id, stage: "selecting" };
    await fileOperations.save(saved);
    assert.deepEqual(await fileOperations.read(key), saved);
  } finally { await unlink(path).catch(() => undefined); }
});
