import { waveSpeedBase, waveSpeedVideoModel, waveSpeedClipModelValid } from "./wavespeed-config";

type Env = Record<string, string | undefined>;
type Check = { status: string; modelId?: string; balanceUsd?: number; amountUsd?: number; listPriceUsd?: number; currency?: "USD" };
export const waveSpeedSmokePayload = { prompt: "A blue wooden cube on a plain studio table. A gentle camera move, natural lighting, no text or logos.", aspect_ratio: "16:9", resolution: "720p", duration: 4, reference_images: [] as string[], generate_audio: false };

async function boundedJson(response: Response) {
  if (!response.body) throw new Error("PREFLIGHT_INVALID_RESPONSE");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 16 * 1024 * 1024) throw new Error("PREFLIGHT_INVALID_RESPONSE"); chunks.push(item.value); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function usableModelArray(value: unknown): value is { id: string }[] {
  return Array.isArray(value) && value.every(model => model && typeof model === "object" && !Array.isArray(model) && typeof model.id === "string" && model.id.length > 0);
}

export async function waveSpeedLivePreflight(env: Env = process.env, fetcher: typeof fetch = fetch) {
  let videoBase: string, llmBase: string, videoModel: string;
  try { videoBase = waveSpeedBase(env.WAVESPEED_VIDEO_BASE_URL, "video"); llmBase = waveSpeedBase(env.WAVESPEED_LLM_BASE_URL, "llm"); videoModel = waveSpeedVideoModel(env); }
  catch { return { ready: false, authentication: { status: "INVALID_CONFIGURATION" } as Check, llmModel: { status: "NOT_CHECKED" } as Check, videoModel: { status: "NOT_CHECKED" } as Check, videoEstimate: { status: "NOT_CHECKED" } as Check }; }
  const key = env.WAVESPEED_API_KEY?.trim(), model = env.WAVESPEED_CLIP_MODEL;
  if (!key) return { ready: false, authentication: { status: "MISSING_WAVESPEED_API_KEY" } as Check, llmModel: { status: "NOT_CHECKED", modelId: waveSpeedClipModelValid(model) ? model : undefined } as Check, videoModel: { status: "NOT_CHECKED", modelId: videoModel } as Check, videoEstimate: { status: "NOT_CHECKED" } as Check };
  async function request(url: string, payload?: unknown) {
    try {
      const response = await fetcher(url, { method: payload === undefined ? "GET" : "POST", redirect: "manual", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) { await response.body?.cancel(); return { status: response.status === 401 ? "AUTHENTICATION_FAILED" : response.status === 403 ? "PERMISSION_DENIED" : response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "UNAVAILABLE" : "HTTP_ERROR", body: null, httpStatus: response.status }; }
      const body = await boundedJson(response);
      return { status: !body || typeof body !== "object" || body.code !== undefined && body.code !== 200 ? "INVALID_RESPONSE" : "OK", body, httpStatus: response.status };
    } catch { return { status: "UNAVAILABLE", body: null, httpStatus: null }; }
  }
  function modelRequestStatus(result: Awaited<ReturnType<typeof request>>) {
    return result.httpStatus === 404 ? "MODEL_NOT_AVAILABLE" : result.status === "OK" && result.httpStatus !== 200 ? "INVALID_RESPONSE" : result.status;
  }
  async function llmAvailability(): Promise<Check> {
    if (!waveSpeedClipModelValid(model)) return { status: "MISSING_OR_INVALID_WAVESPEED_CLIP_MODEL" };
    const catalog = await request(`${llmBase}/models`), catalogStatus = modelRequestStatus(catalog);
    if (catalog.httpStatus !== 200 || catalogStatus !== "OK" && (catalogStatus !== "INVALID_RESPONSE" || catalog.body?.code !== undefined)) return { modelId: model, status: catalogStatus };
    const listedModels: unknown = catalog.body?.data;
    if (usableModelArray(listedModels)) return { modelId: model, status: listedModels.some(m => m.id === model) ? "AVAILABLE" : "MODEL_NOT_AVAILABLE" };
    // An authenticated list can have data:null. Only an authenticated exact-model
    // response proves availability in this case; no global catalog or inference.
    const path = model!.split("/").map(encodeURIComponent).join("/");
    const exact = await request(`${llmBase}/models/${path}`), exactStatus = modelRequestStatus(exact), body = exact.body;
    if (exactStatus !== "OK") return { modelId: model, status: exactStatus };
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.id !== "string" || Object.hasOwn(body, "object") && body.object !== "model") return { modelId: model, status: "INVALID_RESPONSE" };
    return { modelId: model, status: body.id === model ? "AVAILABLE" : "MODEL_NOT_AVAILABLE" };
  }
  const balance = await request(`${videoBase}/api/v3/balance`);
  const authentication: Check = { status: balance.status === "OK" && typeof balance.body?.data?.balance === "number" && Number.isFinite(balance.body.data.balance) ? "AUTHENTICATED" : balance.status === "OK" ? "INVALID_RESPONSE" : balance.status };
  if (authentication.status === "AUTHENTICATED") authentication.balanceUsd = balance.body.data.balance;
  // Catalog reads remain useful when the key lacks the account-balance permission.
  const llmModel = await llmAvailability();
  const models = await request(`${videoBase}/api/v3/models`);
  const video: Check = { modelId: videoModel, status: models.status !== "OK" ? models.status : !Array.isArray(models.body?.data) ? "INVALID_RESPONSE" : models.body.data.some((m: { model_id?: unknown }) => m && m.model_id === videoModel) ? "AVAILABLE" : "MODEL_NOT_AVAILABLE" };
  let videoEstimate: Check = { status: "NOT_CHECKED" };
  if (video.status === "AVAILABLE") {
    // A price calculation is not an inference submission and creates no generation.
    const quote = await request(`${videoBase}/api/v3/model/price`, { model_id: videoModel, inputs: waveSpeedSmokePayload }), data = quote.body?.data;
    videoEstimate = quote.status === "OK" && data?.model_id === videoModel && data.currency === "USD" && [data.price, data.discounted_price].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) ? { status: "ESTIMATED", amountUsd: data.discounted_price, listPriceUsd: data.price, currency: "USD" } : { status: quote.status === "OK" ? "INVALID_RESPONSE" : quote.status };
  }
  return { ready: authentication.status === "AUTHENTICATED" && llmModel.status === "AVAILABLE" && video.status === "AVAILABLE" && videoEstimate.status === "ESTIMATED", authentication, llmModel, videoModel: video, videoEstimate };
}
