import { outreachApiUrl } from "./write";

const campaignIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const activated = new Set(["QUEUED", "RUNNING", "PAUSE_REQUESTED", "PAUSED", "SAFETY_PAUSED", "COMPLETED", "COMPLETED_WITH_ERRORS"]);
const filterNames = new Set(["keyword", "minFollowers", "maxFollowers", "minGmv", "maxGmv", "minUnitsSold", "minAvgVideoViews", "minAvgLiveViewers", "minEngagementRate", "cooldownDays"]);

export class QueueError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export function validCampaignId(id: string) { return campaignIdPattern.test(id); }
export function queueEnabled() { return process.env.OUTREACH_QUEUE_ENABLED === "true"; }

export type ConfirmationSummary = {
  id: string; state: string; version: number; message: string;
  targetCount: number; frozen: number; estimatedMessages: number; freezeExpiresAt: string | null;
  filters: Record<string, string | number>; senderAvailable: boolean; queueEnabled: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QueueError("Outreach returned an invalid campaign response.", 502);
  return value as Record<string, unknown>;
}
function mapFilters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, item]) => filterNames.has(key) && (typeof item === "string" || typeof item === "number"))) as Record<string, string | number>;
}
export function mapConfirmation(value: unknown): ConfirmationSummary {
  const x = asRecord(value), progress = asRecord(x.progress);
  if (typeof x.id !== "string" || !validCampaignId(x.id) || typeof x.state !== "string" || !Number.isSafeInteger(x.version)) throw new QueueError("Outreach campaign data is incomplete.", 502);
  const frozen = Number(progress.frozen);
  if (!Number.isSafeInteger(frozen) || frozen < 0) throw new QueueError("Outreach frozen count is invalid.", 502);
  const capability = x.outboundCapability && typeof x.outboundCapability === "object" ? x.outboundCapability as Record<string, unknown> : {};
  return {
    id: x.id, state: x.state, version: x.version as number,
    message: typeof x.frozenTemplate === "string" && x.state === "FROZEN" ? x.frozenTemplate : typeof x.messageTemplate === "string" ? x.messageTemplate : "",
    targetCount: Number(x.targetCount) || 0,
    frozen, estimatedMessages: frozen, freezeExpiresAt: typeof x.freezeExpiresAt === "string" ? x.freezeExpiresAt : null,
    filters: mapFilters(x.state === "FROZEN" ? x.frozenFilters : x.filters),
    senderAvailable: x.outboundEnabled === true && capability.available === true && capability.mode === "LIVE" && capability.workerState === "RUNNING",
    queueEnabled: queueEnabled(),
  };
}
async function nativeCampaign(id: string, fetcher: typeof fetch) {
  if (!validCampaignId(id)) throw new QueueError("Invalid campaign ID.", 400);
  let response: Response;
  try { response = await fetcher(`${outreachApiUrl()}/api/v1/outreach/campaigns/${id}`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(10000) }); }
  catch { throw new QueueError("Outreach backend is unavailable.", 503); }
  if (response.status === 404) throw new QueueError("Campaign no longer exists.", 404);
  if (!response.ok) throw new QueueError("Campaign status could not be refreshed.", 502);
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new QueueError("Outreach returned an invalid campaign response.", 502); }
  return mapConfirmation(data);
}
export async function getConfirmationSummary(id: string, fetcher: typeof fetch = fetch) { return nativeCampaign(id, fetcher); }

const inFlight = new Map<string, Promise<{ campaign: ConfirmationSummary; alreadyQueued: boolean }>>();
export async function confirmAndQueueCampaign(id: string, expectedVersion: number, fetcher: typeof fetch = fetch): Promise<{ campaign: ConfirmationSummary; alreadyQueued: boolean }> {
  if (!queueEnabled()) throw new QueueError("Campaign is ready. Production queueing is currently disabled.", 503);
  const key = `${id}:${expectedVersion}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const action = confirmAndQueueCampaignOnce(id, expectedVersion, fetcher);
  inFlight.set(key, action);
  try { return await action; } finally { if (inFlight.get(key) === action) inFlight.delete(key); }
}

async function confirmAndQueueCampaignOnce(id: string, expectedVersion: number, fetcher: typeof fetch): Promise<{ campaign: ConfirmationSummary; alreadyQueued: boolean }> {
  if (!validCampaignId(id)) throw new QueueError("Invalid campaign ID.", 400);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new QueueError("Campaign version is invalid.", 400);
  const current = await nativeCampaign(id, fetcher);
  if (current.id !== id) throw new QueueError("Campaign identity changed. Refresh before confirming.", 409);
  if (activated.has(current.state)) return { campaign: current, alreadyQueued: true };
  if (current.state !== "FROZEN") throw new QueueError("Campaign is not frozen and ready to queue.", 409);
  if (current.version !== expectedVersion) throw new QueueError("Campaign changed. Refresh the confirmation before retrying.", 409);
  if (current.frozen < 1) throw new QueueError("No frozen recipients remain. Rebuild the preview in the native workflow.", 409);
  const expiry = current.freezeExpiresAt ? Date.parse(current.freezeExpiresAt) : NaN;
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new QueueError("Frozen recipients have expired. Refresh the campaign.", 409);
  if (!current.senderAvailable) throw new QueueError("The native Outreach sender is unavailable.", 503);
  let response: Response;
  try {
    response = await fetcher(`${outreachApiUrl()}/api/v1/outreach/campaigns/${id}/send`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: expectedVersion }), cache: "no-store", signal: AbortSignal.timeout(120000),
    });
  } catch { throw new QueueError("Queue result is uncertain. Refresh the campaign before trying again.", 503); }
  if (!response.ok) {
    if (response.status === 409 || response.status === 400) throw new QueueError("Queue request was rejected. Refresh the campaign state before retrying.", 409);
    if (response.status === 503) throw new QueueError("The native Outreach sender is unavailable.", 503);
    throw new QueueError("Outreach rejected the queue request.", 502);
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new QueueError("Outreach did not return a valid queue confirmation. Refresh its status.", 502); }
  const result = mapConfirmation(data);
  if (result.id !== id || !activated.has(result.state)) throw new QueueError("Outreach did not confirm that the campaign was queued. Refresh its status.", 502);
  return { campaign: result, alreadyQueued: false };
}
