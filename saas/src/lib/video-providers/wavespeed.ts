import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { AiVideoInput, FrozenAsset } from "../job-core";
import { maxGeneratedVideoBytes } from "../provider-ingest";
import { objectStorage, type ObjectStorage } from "../storage";
import { waveSpeedBase, waveSpeedVideoModel } from "../wavespeed-config";
import { ProviderSafeError, SubmissionUnknownError, type ProviderCapabilities, type ProviderPoll, type VideoProvider } from "./types";

const capabilities: ProviderCapabilities = { minDurationSeconds: 4, maxDurationSeconds: 30, aspectRatios: ["9:16", "16:9", "1:1"], maxReferenceImages: 4, maxQuantity: 1 };
// Exact provider CDN names: official WaveSpeedAI/wavespeed-comfyui README and
// examples/case5-video-to-video/case5-v2v.json, plus d2h7xmz5gqybh9 observed in
// authenticated Seedance prediction 3aa327ae4d2a46ff899c9ac5c42986e2. No wildcards.
const OUTPUT_HOSTS = new Set(["cdn.wavespeed.ai", "d2p7pge43lyniu.cloudfront.net", "d2h7xmz5gqybh9.cloudfront.net"]);
const privateAddresses = new BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) privateAddresses.addSubnet(address, prefix, "ipv4");
const publicV6 = new BlockList();
publicV6.addSubnet("2000::", 3, "ipv6");
privateAddresses.addSubnet("2001:db8::", 32, "ipv6");

type Resolve = (hostname: string) => Promise<{ address: string; family: number }[]>;
type Dependencies = { fetch?: typeof fetch; storage?: () => ObjectStorage; resolve?: Resolve };
const defaultResolve: Resolve = hostname => lookup(hostname, { all: true, verbatim: true });
const unavailable = () => new ProviderSafeError("PROVIDER_UNAVAILABLE", "WaveSpeed video generation is not configured.");
const referenceUnavailable = () => new ProviderSafeError("REFERENCE_UNAVAILABLE", "Product references require verified, reachable HTTPS storage with valid signed URLs.");

export function waveSpeedOutputUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ProviderSafeError("OUTPUT_INVALID", "The provider output address was invalid."); }
  // URL normalizes an explicit :443 and an empty fragment; reject them too.
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value.trim())?.[1];
  if (url.protocol !== "https:" || !OUTPUT_HOSTS.has(url.hostname) || url.port || url.username || url.password || url.hash || authority?.includes(":") || authority?.includes("@") || value.includes("#")) {
    throw new ProviderSafeError("OUTPUT_INVALID", "The provider output host was invalid.");
  }
  return url;
}

export function waveSpeedReferenceSettings(env: Record<string, string | undefined> = process.env) {
  try {
    if (env.WAVESPEED_REFERENCE_FETCH_VERIFIED !== "1") throw referenceUnavailable();
    const endpoint = new URL(env.OBJECT_STORAGE_PUBLIC_ENDPOINT || env.OBJECT_STORAGE_ENDPOINT || "");
    if (endpoint.protocol !== "https:" || endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || isIP(endpoint.hostname.replace(/^\[|\]$/g, "")) || !endpoint.hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(endpoint.hostname)) throw referenceUnavailable();
    const ttl = Number(env.WAVESPEED_REFERENCE_URL_TTL_SECONDS || 3600);
    if (!Number.isSafeInteger(ttl) || ttl < 3600 || ttl > 7200) throw referenceUnavailable();
    return { origin: endpoint.origin, ttl };
  } catch { throw referenceUnavailable(); }
}

async function readJson(response: Response, maximum = 1024 * 1024): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error("Missing JSON response");
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.length; if (size > maximum) throw new Error("JSON response exceeds limit");
      chunks.push(item.value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid JSON response");
    return body;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function prediction(body: Record<string, unknown>) {
  if (body.code !== undefined && body.code !== 200) throw new Error("Unsuccessful prediction response");
  const data = body.data ?? body;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid prediction response");
  return data as Record<string, unknown>;
}

export class WaveSpeedVideoProvider implements VideoProvider {
  readonly name = "WAVESPEED" as const;
  private fetcher: typeof fetch;
  private storage: () => ObjectStorage;
  private resolve: Resolve;
  constructor(dependencies: Dependencies = {}) {
    this.fetcher = dependencies.fetch || ((...args) => fetch(...args));
    this.storage = dependencies.storage || objectStorage;
    this.resolve = dependencies.resolve || defaultResolve;
  }
  capabilities() { return capabilities; }
  validateInput(input: AiVideoInput) {
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 4 || input.durationSeconds > 30 || !capabilities.aspectRatios.includes(input.aspectRatio) || input.quantity !== 1 || input.referenceAssetVersionIds.length > 4 || new Set(input.referenceAssetVersionIds).size !== input.referenceAssetVersionIds.length) throw new ProviderSafeError("INVALID_INPUT", "This Seedance video request is not supported.");
    for (const id of input.referenceAssetVersionIds) {
      const asset = input.product.assets.find(a => a.assetVersionId === id);
      if (!asset || asset.type !== "IMAGE" || !["image/png", "image/jpeg", "image/webp"].includes(asset.mimeType) || asset.byteSize < 1 || asset.byteSize > 4 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new ProviderSafeError("INVALID_INPUT", "A selected Product reference is unavailable or unsupported.");
    }
    if (input.referenceAssetVersionIds.length) waveSpeedReferenceSettings();
  }
  private configuration() {
    try {
      const base = waveSpeedBase(process.env.WAVESPEED_VIDEO_BASE_URL, "video");
      const key = process.env.WAVESPEED_API_KEY?.trim(); if (!key) throw unavailable();
      return { base, key };
    } catch { throw unavailable(); }
  }
  private async publicHost(hostname: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const addresses = await Promise.race([this.resolve(hostname), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(referenceUnavailable()), 3000); })]);
      if (!addresses.length || addresses.some(a => a.family === 4 ? privateAddresses.check(a.address, "ipv4") : a.family !== 6 || !publicV6.check(a.address, "ipv6") || privateAddresses.check(a.address, "ipv6"))) throw referenceUnavailable();
    } finally { if (timer) clearTimeout(timer); }
  }
  async referenceUrls(input: AiVideoInput) {
    this.validateInput(input);
    if (!input.referenceAssetVersionIds.length) return [];
    const { origin, ttl } = waveSpeedReferenceSettings();
    try {
      await this.publicHost(new URL(origin).hostname);
      const storage = this.storage();
      return await Promise.all(input.referenceAssetVersionIds.map(async id => {
        const asset = input.product.assets.find(a => a.assetVersionId === id)!;
        const value = await storage.issueDownload(asset.storageKey, "product-reference", ttl);
        const url = new URL(value), date = url.searchParams.get("X-Amz-Date") || "", expires = Number(url.searchParams.get("X-Amz-Expires"));
        const signedAt = /^\d{8}T\d{6}Z$/.test(date) ? Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")) : NaN;
        if (url.origin !== origin || url.username || url.password || url.hash || !url.searchParams.get("X-Amz-Signature") || url.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" || expires !== ttl || !Number.isFinite(signedAt) || signedAt > Date.now() + 60000 || signedAt + expires * 1000 - Date.now() < (ttl - 60) * 1000) throw referenceUnavailable();
        await this.verifyReference(url, asset);
        return value; // Request memory only: never persisted in the input, artifacts or logs.
      }));
    } catch { throw referenceUnavailable(); }
  }
  private async verifyReference(url: URL, asset: FrozenAsset) {
    const response = await this.fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.body || (response.headers.get("content-type") || "").split(";")[0] !== asset.mimeType) { await response.body?.cancel(); throw referenceUnavailable(); }
    const reader = response.body.getReader(), hash = createHash("sha256"); let size = 0;
    try {
      for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > asset.byteSize || size > 4 * 1024 * 1024) throw referenceUnavailable(); hash.update(item.value); }
      if (size !== asset.byteSize || hash.digest("hex") !== asset.sha256) throw referenceUnavailable();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async submit(input: AiVideoInput, model: string) {
    this.validateInput(input);
    const { base, key } = this.configuration();
    try { if (model !== waveSpeedVideoModel()) throw unavailable(); } catch { throw unavailable(); }
    const reference_images = await this.referenceUrls(input);
    const payload = { prompt: `${input.customerPrompt}\n\nProduct accuracy guidance: ${input.accuracyInstructions}\nUse only the supplied Product facts and references; do not invent Product claims.`, aspect_ratio: input.aspectRatio, resolution: "720p", duration: input.durationSeconds, reference_images, generate_audio: false };
    // Exactly one POST. A transport error, timeout, redirect, 5xx, or missing ID may
    // already have been billed. The durable runner moves it to RECONCILING.
    let response: Response;
    try { response = await this.fetcher(`${base}/api/v3/${model}`, { method: "POST", redirect: "manual", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) }); }
    catch { throw new SubmissionUnknownError(); }
    if (response.status === 429) { await response.body?.cancel(); throw new ProviderSafeError("PROVIDER_RATE_LIMIT", "The video provider is busy. Retrying shortly.", true); }
    if (response.status >= 500 || response.status === 408 || response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new SubmissionUnknownError(); }
    if (!response.ok) { await response.body?.cancel(); throw new ProviderSafeError(response.status === 400 || response.status === 422 ? "PROVIDER_REJECTED" : "PROVIDER_UNAVAILABLE", "The video provider rejected this request."); }
    try {
      const data = prediction(await readJson(response));
      if (typeof data.id !== "string" || !/^[A-Za-z0-9_-]{4,160}$/.test(data.id) || data.id.includes(key)) throw new Error("Invalid prediction ID");
      return { externalTaskId: data.id };
    } catch { throw new SubmissionUnknownError(); }
  }
  async findBySubmissionToken() { return null; } // No documented idempotency/lookup endpoint.
  async poll(externalTaskId: string): Promise<ProviderPoll> {
    if (!/^[A-Za-z0-9_-]{4,160}$/.test(externalTaskId)) throw new ProviderSafeError("PROVIDER_REJECTED", "Provider prediction ID is invalid.");
    const { base, key } = this.configuration();
    let data: Record<string, unknown>;
    try {
      const response = await this.fetcher(`${base}/api/v3/predictions/${encodeURIComponent(externalTaskId)}/result`, { redirect: "manual", headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) { await response.body?.cancel(); throw new ProviderSafeError(response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_UNAVAILABLE", "The video provider status is temporarily unavailable.", ![401, 403].includes(response.status)); }
      data = prediction(await readJson(response));
    } catch (error) { throw error instanceof ProviderSafeError ? error : new ProviderSafeError("PROVIDER_UNAVAILABLE", "The video provider status is temporarily unavailable.", true); }
    if (data.id !== externalTaskId) throw new ProviderSafeError("PROVIDER_UNAVAILABLE", "The provider prediction identity did not match.", true);
    const statuses: Record<string, ProviderPoll["status"]> = { created: "queued", queued: "queued", pending: "queued", processing: "running", running: "running", completed: "succeeded", failed: "failed", cancelled: "cancelled", canceled: "cancelled", timeout: "failed", deleted: "failed" };
    const status = typeof data.status === "string" && Object.hasOwn(statuses, data.status) ? statuses[data.status] : undefined;
    if (!status) throw new ProviderSafeError("PROVIDER_UNAVAILABLE", "The video provider status was unknown.", true);
    if (status !== "succeeded") return { status, ...(["failed", "cancelled"].includes(status) ? { errorCode: `WAVESPEED_${String(data.status).toUpperCase()}` } : {}) };
    if (!Array.isArray(data.outputs) || data.outputs.length !== 1 || typeof data.outputs[0] !== "string" || data.outputs[0].includes(key)) throw new ProviderSafeError("OUTPUT_INVALID", "The video provider did not return one video output.");
    const outputUrl = waveSpeedOutputUrl(data.outputs[0]).href;
    return { status, outputUrl };
  }
  // WaveSpeed's documented delete API deletes finished predictions; it is NOT cancellation.
  async cancel() { return false; }
  async retrieve(poll: ProviderPoll) {
    if (!poll.outputUrl) throw new ProviderSafeError("OUTPUT_INVALID", "The video provider did not return an output.");
    const url = waveSpeedOutputUrl(poll.outputUrl);
    let response: Response;
    try { response = await this.fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(60000) }); }
    catch { throw new ProviderSafeError("OUTPUT_UNAVAILABLE", "The video download is temporarily unavailable.", true); }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new ProviderSafeError("OUTPUT_UNAVAILABLE", "The video download is temporarily unavailable.", true); }
    const mimeType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const length = response.headers.get("content-length"), contentLength = length === null ? undefined : Number(length), maximum = maxGeneratedVideoBytes();
    if (!["video/mp4", "application/octet-stream"].includes(mimeType) || contentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > maximum)) { await response.body.cancel(); throw new ProviderSafeError("OUTPUT_INVALID", "The provider video type or size was invalid."); }
    const body = response.body;
    const stream = (async function* () {
      const reader = body.getReader(); let size = 0;
      try {
        for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > maximum) throw new ProviderSafeError("OUTPUT_INVALID", "The generated video exceeds the allowed size."); yield item.value; }
      } catch (error) { throw error instanceof ProviderSafeError ? error : new ProviderSafeError("OUTPUT_UNAVAILABLE", "The video download was interrupted.", true); }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    })();
    return { stream, mimeType, contentLength };
  }
  normalizeProgress(poll: ProviderPoll) { return poll.status === "queued" ? { percent: 10, stage: "provider_queued", message: "Queued with video provider" } : poll.status === "running" ? { percent: 40, stage: "generating", message: "Generating video" } : { percent: 80, stage: "finalizing", message: "Preparing video output" }; }
  mapError(error: unknown) { return error instanceof ProviderSafeError || error instanceof SubmissionUnknownError ? error : new ProviderSafeError("INTERNAL_ERROR", "Video processing could not continue."); }
}
