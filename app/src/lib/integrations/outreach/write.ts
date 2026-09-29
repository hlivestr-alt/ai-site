const base = "http://127.0.0.1:4000";
const metrics = ["GMV", "UNITS_SOLD", "FOLLOWERS", "AVG_VIDEO_VIEWS", "AVG_LIVE_VIEWERS", "ENGAGEMENT_RATE", "TIKTOK_RELEVANCE"] as const;
type Metric = typeof metrics[number];

export type DraftInput = {
  messageTemplate: string; targetCount: number; cooldownDays: number;
  rankingMetric: Metric; filters: { keyword?: string; minFollowers?: number; maxFollowers?: number; minGmv?: number; maxGmv?: number; minUnitsSold?: number; minAvgVideoViews?: number; minAvgLiveViewers?: number; minEngagementRate?: number };
};

export function validateDraft(value: unknown): DraftInput {
  if (!value || typeof value !== "object") throw new Error("Campaign details are required");
  const x = value as Record<string, unknown>;
  if (typeof x.messageTemplate !== "string" || !x.messageTemplate.trim() || x.messageTemplate.length > 2000) throw new Error("Message must be 1–2,000 characters");
  if (!Number.isInteger(x.targetCount) || Number(x.targetCount) < 1 || Number(x.targetCount) > 500) throw new Error("Target must be 1–500; the native shop limit may be lower");
  if (!Number.isInteger(x.cooldownDays) || Number(x.cooldownDays) < 0 || Number(x.cooldownDays) > 3650) throw new Error("Cooldown must be 0–3,650 days");
  if (!metrics.includes(x.rankingMetric as Metric)) throw new Error("Ranking metric is unsupported");
  const raw = x.filters && typeof x.filters === "object" ? x.filters as Record<string, unknown> : {};
  const allowed = ["keyword", "minFollowers", "maxFollowers", "minGmv", "maxGmv", "minUnitsSold", "minAvgVideoViews", "minAvgLiveViewers", "minEngagementRate"];
  if (Object.keys(raw).some(key => !allowed.includes(key))) throw new Error("Filter is unsupported");
  const filters: DraftInput["filters"] = {};
  for (const [key, item] of Object.entries(raw)) {
    if (key === "keyword") { if (typeof item !== "string" || item.length > 100) throw new Error("Keyword is invalid"); filters.keyword = item; }
    else { if (typeof item !== "number" || !Number.isFinite(item) || item < 0) throw new Error(`${key} must be non-negative`); (filters as Record<string, unknown>)[key] = item; }
  }
  if (filters.minFollowers !== undefined && filters.maxFollowers !== undefined && filters.minFollowers > filters.maxFollowers) throw new Error("Follower range is invalid");
  if (filters.minGmv !== undefined && filters.maxGmv !== undefined && filters.minGmv > filters.maxGmv) throw new Error("GMV range is invalid");
  return { messageTemplate: x.messageTemplate, targetCount: Number(x.targetCount), cooldownDays: Number(x.cooldownDays), rankingMetric: x.rankingMetric as Metric, filters };
}

export function validateVersion(value: unknown): number {
  if (!value || typeof value !== "object" || !Number.isSafeInteger((value as { version?: unknown }).version) || Number((value as { version: number }).version) < 1) throw new Error("Current campaign version is required");
  return Number((value as { version: number }).version);
}

export function outreachApiUrl(value = process.env.OUTREACH_API_URL): string {
  const url = new URL(value || base);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/" || url.username || url.password) throw new Error("Outreach API must be local HTTP");
  return url.origin;
}

export async function nativeAction(path: string, body: unknown, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  if (!/^\/api\/v1\/outreach\/campaigns(?:\/[a-f0-9-]+\/(?:discovery-runs|freeze))?$/.test(path)) throw new Error("Action is not allowed");
  const response = await fetcher(`${outreachApiUrl()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Outreach rejected the action (${response.status}). Refresh the campaign in the native app if needed.`);
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error("Outreach response was invalid"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Outreach response was invalid");
  return data as Record<string, unknown>;
}

export function mapPreviewRecipients(data: unknown) {
  if (!Array.isArray(data)) throw new Error("Recipient response was invalid");
  return data.slice(0, 1000).map((item: unknown) => {
    const r = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const creator = r.creator && typeof r.creator === "object" ? r.creator as Record<string, unknown> : {};
    const snapshot = r.snapshot && typeof r.snapshot === "object" ? r.snapshot as Record<string, unknown> : {};
    return { selected: r.selected === true, eligibility: String(r.eligibility ?? ""), skipReason: typeof r.skipReason === "string" ? r.skipReason : null, displayName: String(creator.nickname || creator.username || "Creator"), username: typeof creator.username === "string" ? creator.username : null, followerCount: typeof snapshot.followerCount === "number" ? snapshot.followerCount : null, categories: Array.isArray(snapshot.categoryIds) ? snapshot.categoryIds.filter((item): item is string => typeof item === "string").slice(0, 3) : [] };
  });
}

export async function nativeRecipients(id: string, fetcher: typeof fetch = fetch) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid campaign ID");
  const response = await fetcher(`${outreachApiUrl()}/api/v1/outreach/campaigns/${id}/recipients`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Recipient preview unavailable (${response.status})`);
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error("Recipient response was invalid"); }
  return mapPreviewRecipients(data);
}
