import assert from "node:assert/strict";
import { test } from "node:test";
import { CAMPAIGNS_SQL, databaseUrl, getOutreachOverview } from "./index";

test("Outreach connection accepts only local PostgreSQL", () => {
  assert.equal(databaseUrl("postgresql://u:p@127.0.0.1:5432/db"), "postgresql://u:p@127.0.0.1:5432/db");
  assert.throws(() => databaseUrl("postgresql://u:p@example.com/db"));
});

test("Outreach performs a read-only transaction and matches terminal remaining calculation", async () => {
  const previous = process.env.OUTREACH_DATABASE_URL;
  process.env.OUTREACH_DATABASE_URL = "postgresql://u:p@127.0.0.1:5432/db";
  const calls: string[] = [];
  try {
    const result = await getOutreachOverview(() => ({
      connect: async () => undefined,
      query: async (sql: string) => { calls.push(sql); return { rows: sql === CAMPAIGNS_SQL ? [{ id: "1", name: "Campaign", state: "RUNNING", targetCount: 10, createdAt: "2026-09-01", frozen: 10, queued: 1, sending: 1, sent: 4, failed: 1, restricted: 1, deliveryUnknown: 1, deliveryUnknownUnresolved: 0, cancelled: 0 }] : [] } as never; },
      end: async () => undefined,
    }) as never);
    assert.deepEqual(calls, ["BEGIN READ ONLY", CAMPAIGNS_SQL, "COMMIT"]);
    assert.equal(result.campaigns[0].remaining, 4);
    assert.equal(result.campaigns[0].deliveryUnknown, 1);
  } finally { if (previous === undefined) delete process.env.OUTREACH_DATABASE_URL; else process.env.OUTREACH_DATABASE_URL = previous; }
});
