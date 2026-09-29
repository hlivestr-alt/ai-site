export type BridgeStatus = { state: "connected" | "offline" | "misconfigured"; validation: "ready" | "unavailable"; generation: "disabled" | "test_only" | "available"; readyToGenerate: boolean; comfy: "idle" | "busy" | "offline" | "unknown"; creative: "idle" | "busy" | "unavailable" | "unknown"; message: string; capabilities?: { durations: number[]; resolutions: string[]; aspectRatios: string[] } };

export function bridgeUrl(value = process.env.H3_BRIDGE_URL) {
  const url = new URL(value || "http://127.0.0.1:8788");
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/" || url.username || url.password) throw new Error("Bridge URL must be local HTTP");
  return url.origin;
}
export async function getBridgeStatus(fetcher: typeof fetch = fetch): Promise<BridgeStatus> {
  let origin: string;
  try { origin = bridgeUrl(); } catch { return { state: "misconfigured", validation: "unavailable", generation: "disabled", readyToGenerate: false, comfy: "unknown", creative: "unknown", message: "Bridge configuration is invalid." }; }
  try {
    const response = await fetcher(`${origin}/health`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error("Offline");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") throw new Error("Invalid health");
    const x = body as Record<string, unknown>;
    if (x.service !== "ai-site-h3-bridge" || x.validation !== "ready" || !["disabled", "test_only", "available"].includes(String(x.generation))) throw new Error("Invalid bridge contract");
    const comfy = ["idle", "busy", "offline"].includes(String(x.comfy)) ? x.comfy as BridgeStatus["comfy"] : "unknown";
    const creative = ["idle", "busy", "unavailable"].includes(String(x.creative)) ? x.creative as BridgeStatus["creative"] : "unknown";
    const generation = x.generation as BridgeStatus["generation"];
    const readyToGenerate = generation === "available" && x.readyToGenerate === true && comfy === "idle" && creative === "idle";
    const message = readyToGenerate ? "H3 generation is ready." : comfy === "busy" || creative === "busy" ? "H3 is currently busy with another generation." : generation === "test_only" ? "Bridge is in controlled test mode." : generation === "disabled" ? "H3 generation is disabled." : "H3 generation is unavailable while validation is incomplete.";
    const raw = x.capabilities && typeof x.capabilities === "object" ? x.capabilities as Record<string, unknown> : {};
    const capabilities = { durations: Array.isArray(raw.durations) ? raw.durations.filter((n): n is number => Number.isInteger(n) && n >= 4 && n <= 15) : [8], resolutions: Array.isArray(raw.resolutions) ? raw.resolutions.filter((n): n is string => typeof n === "string" && /^\d{3,4}x\d{3,4}$/.test(n)) : ["576x1024"], aspectRatios: ["9:16"] };
    return { state: "connected", validation: "ready", generation, readyToGenerate, comfy, creative, message, capabilities };
  } catch { return { state: "offline", validation: "unavailable", generation: "disabled", readyToGenerate: false, comfy: "unknown", creative: "unknown", message: "H3 bridge is offline." }; }
}
