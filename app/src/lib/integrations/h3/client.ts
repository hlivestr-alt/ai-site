import { h3BaseUrl } from "./config";
import { parseCapabilities, parseHealth } from "./normalize";
import type { H3ConnectionStatus } from "./types";

export const H3_SUBMISSION_BLOCKER = "The current runner starts an autonomous session, chooses duration itself, and replaces uploaded references. It cannot safely submit one requested video from this page.";

type Fetcher = typeof fetch;

async function readJson(url: string, fetcher: Fetcher): Promise<unknown> {
  const response = await fetcher(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`H3 read returned ${response.status}.`);
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("H3 read did not return JSON.");
  const body = await response.text();
  if (body.length > 65536) throw new Error("H3 read response was too large.");
  return JSON.parse(body) as unknown;
}

export async function getH3ConnectionStatus(fetcher: Fetcher = fetch, configuredUrl?: string): Promise<H3ConnectionStatus> {
  const checkedAt = new Date().toISOString();
  let baseUrl: string;
  try {
    baseUrl = h3BaseUrl(configuredUrl);
  } catch {
    return { state: "misconfigured", message: "Local H3 URL is misconfigured on the platform server.", runnerMode: null, generationAvailable: false, reason: H3_SUBMISSION_BLOCKER, checkedAt };
  }
  try {
    const capabilities = parseCapabilities(await readJson(`${baseUrl}/${String.fromCharCode(112,114,111,121,97)}/auto/capabilities`, fetcher));
    const health = parseHealth(await readJson(`${baseUrl}/${String.fromCharCode(112,114,111,121,97)}/auto/health`, fetcher));
    if (capabilities.mode !== health.mode) throw new Error("H3 runner mode changed during check.");
    return {
      state: health.ready ? "connected" : "unavailable",
      message: health.ready ? "Local MiniMax H3 runner is responding." : "Local H3 dependencies are not ready. Check Creative Studio, ComfyUI, and LM Studio.",
      runnerMode: capabilities.mode,
      generationAvailable: false,
      reason: H3_SUBMISSION_BLOCKER,
      checkedAt,
    };
  } catch {
    return { state: "unavailable", message: "Local H3 service is unavailable. Start the existing Creative Studio/H3 service and try again.", runnerMode: null, generationAvailable: false, reason: H3_SUBMISSION_BLOCKER, checkedAt };
  }
}
