import { Client } from "pg";

export type Campaign = {
  id: string; name: string; state: string; version: number; targetCount: number; createdAt: string;
  preview: { evaluated: number; eligible: number; selected: number; excludedByFilter: number; skippedCooldown: number; skippedDoNotContact: number; skippedUnknownDelivery: number; skippedActiveReservation: number };
  frozen: number; queued: number; sending: number; sent: number; failed: number;
  restricted: number; deliveryUnknown: number; cancelled: number; remaining: number;
};
export type OutreachOverview = { state: "connected" | "disconnected" | "misconfigured"; message: string; campaigns: Campaign[] };

// The native campaign-list GET expires frozen campaigns before reading. This SELECT is intentionally separate.
export const CAMPAIGNS_SQL = `
SELECT c.id, c.name, c.state::text AS state, c.version, c.summary, c."targetCount", c."createdAt",
  COUNT(r.id)::int AS frozen,
  COUNT(r.id) FILTER (WHERE r.state = 'QUEUED')::int AS queued,
  COUNT(r.id) FILTER (WHERE r.state = 'PROCESSING')::int AS sending,
  COUNT(r.id) FILTER (WHERE r.state = 'SENT')::int AS sent,
  COUNT(r.id) FILTER (WHERE r.state = 'FAILED')::int AS failed,
  COUNT(r.id) FILTER (WHERE r.state = 'RESTRICTED')::int AS restricted,
  COUNT(r.id) FILTER (WHERE r.state IN ('DELIVERY_UNKNOWN', 'DELIVERY_UNKNOWN_UNRESOLVED'))::int AS "deliveryUnknown",
  COUNT(r.id) FILTER (WHERE r.state = 'DELIVERY_UNKNOWN_UNRESOLVED')::int AS "deliveryUnknownUnresolved",
  COUNT(r.id) FILTER (WHERE r.state = 'CANCELLED')::int AS cancelled
FROM "Campaign" c
LEFT JOIN "CampaignRecipient" r ON r."campaignId" = c.id AND r.selected = true AND r."frozenMessage" IS NOT NULL
GROUP BY c.id
ORDER BY c."createdAt" DESC
LIMIT 100`;

export function databaseUrl(value = process.env.OUTREACH_DATABASE_URL): string {
  if (!value) throw new Error("Outreach database URL missing");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Outreach database must be local PostgreSQL");
  }
  return value;
}

type QueryClient = Pick<Client, "connect" | "query" | "end">;
export async function getOutreachOverview(factory: (url: string) => QueryClient = url => new Client({ connectionString: url, connectionTimeoutMillis: 4000, query_timeout: 5000 })): Promise<OutreachOverview> {
  let url: string;
  try { url = databaseUrl(); }
  catch { return { state: "misconfigured", message: "Outreach read-only connection is not configured.", campaigns: [] }; }
  const client = factory(url);
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const response = await client.query(CAMPAIGNS_SQL);
    await client.query("COMMIT");
    const campaigns: Campaign[] = response.rows.map((row: Record<string, unknown>) => {
      const frozen = Number(row.frozen), sent = Number(row.sent), failed = Number(row.failed), restricted = Number(row.restricted), cancelled = Number(row.cancelled);
      const deliveryUnknown = Number(row.deliveryUnknown);
      const summary = row.summary && typeof row.summary === "object" ? row.summary as Record<string, unknown> : {};
      const preview = { evaluated: Number(summary.fetchedOccurrences ?? 0), eligible: Number(summary.eligible ?? 0), selected: Number(summary.selected ?? 0), excludedByFilter: Number(summary.excludedByFilter ?? 0), skippedCooldown: Number(summary.skippedCooldown ?? 0), skippedDoNotContact: Number(summary.skippedDoNotContact ?? 0), skippedUnknownDelivery: Number(summary.skippedUnknownDelivery ?? 0), skippedActiveReservation: Number(summary.skippedActiveReservation ?? 0) };
      return {
        id: String(row.id), name: String(row.name), state: String(row.state), version: Number(row.version), targetCount: Number(row.targetCount),
        createdAt: new Date(row.createdAt as string).toISOString(), preview, frozen, queued: Number(row.queued), sending: Number(row.sending),
        sent, failed, restricted, deliveryUnknown, cancelled,
        remaining: Math.max(0, frozen - sent - failed - restricted - cancelled - Number(row.deliveryUnknownUnresolved ?? 0)),
      };
    });
    return { state: "connected", message: "Campaign and sending counts are read directly in a read-only transaction.", campaigns };
  } catch {
    try { await client.query("ROLLBACK"); } catch { /* connection may already be closed */ }
    return { state: "disconnected", message: "Outreach database is unavailable or the read-only query failed.", campaigns: [] };
  } finally { await client.end().catch(() => undefined); }
}
