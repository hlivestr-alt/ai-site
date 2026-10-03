type Env = Record<string, string | undefined>;

export const WAVESPEED_VIDEO_MODEL = "bytedance/seedance-2.5/text-to-video";
export const WAVESPEED_VIDEO_BASE = "https://api.wavespeed.ai";
export const WAVESPEED_LLM_BASE = "https://llm.wavespeed.ai/v1";

// Credentials can only be sent to these official origins. No proxy or redirect fallback.
export function waveSpeedBase(value: string | undefined, kind: "video" | "llm") {
  const expected = kind === "video" ? WAVESPEED_VIDEO_BASE : WAVESPEED_LLM_BASE;
  const url = new URL(value || expected);
  if (url.href.replace(/\/$/, "") !== expected || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid WaveSpeed API base configuration");
  }
  return expected;
}

export function waveSpeedVideoModel(env: Env = process.env) {
  const model = env.WAVESPEED_SEEDANCE_MODEL || WAVESPEED_VIDEO_MODEL;
  if (model !== WAVESPEED_VIDEO_MODEL) throw new Error("Unverified WaveSpeed video model configuration");
  return model;
}

export function waveSpeedClipModelValid(model: string | undefined) {
  return !!model && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}\/[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(model);
}

export function waveSpeedVideoConfigured(env: Env = process.env) {
  try {
    waveSpeedBase(env.WAVESPEED_VIDEO_BASE_URL, "video");
    waveSpeedVideoModel(env);
    return !!env.WAVESPEED_API_KEY?.trim();
  } catch { return false; }
}

export function waveSpeedAnalyzerConfigured(env: Env = process.env, workerAttestation = false) {
  try {
    waveSpeedBase(env.WAVESPEED_LLM_BASE_URL, "llm");
    return waveSpeedClipModelValid(env.WAVESPEED_CLIP_MODEL) &&
      (!!env.WAVESPEED_API_KEY?.trim() || workerAttestation && env.CLIP_ANALYZER_WORKER_CREDENTIAL_CONFIGURED === "1");
  } catch { return false; }
}
