import { outreachApiUrl } from "./write";
import { queueEnabled } from "./queue";

export type OutreachSystemStatus = { state: "connected" | "offline"; sender: "available" | "unavailable" | "unknown"; worker: string; message: string };
export async function getOutreachSystemStatus(fetcher: typeof fetch = fetch): Promise<OutreachSystemStatus> {
  try {
    const response = await fetcher(`${outreachApiUrl()}/api/v1/system/status`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("offline");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") throw new Error("invalid");
    const x = data as Record<string, unknown>;
    const outbound = x.outbound && typeof x.outbound === "object" ? x.outbound as Record<string, unknown> : {};
    const workers = x.workers && typeof x.workers === "object" ? x.workers as Record<string, unknown> : {};
    const worker = String(workers.outbound ?? outbound.workerState ?? "unknown");
    return { state: "connected", sender: outbound.enabled === true && outbound.mode === "LIVE" && worker === "RUNNING" ? "available" : "unavailable", worker, message: queueEnabled() ? "Native sender status is reported by Outreach. Platform queueing is enabled." : "Native sender status is reported by Outreach. Platform queueing remains disabled." };
  } catch { return { state: "offline", sender: "unknown", worker: "unknown", message: "Native Outreach status is unavailable." }; }
}
