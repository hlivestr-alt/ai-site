import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { resolve } from "node:path";
import { waveSpeedLivePreflight } from "../src/lib/wavespeed-preflight";

async function main() {
  const env = { ...process.env };
  if (env.PRIVATE_WORKER_ENV_FILE) {
    try {
      const worker = parseEnv(await readFile(resolve(env.PRIVATE_WORKER_ENV_FILE), "utf8"));
      for (const name of ["WAVESPEED_API_KEY", "WAVESPEED_CLIP_MODEL", "WAVESPEED_LLM_BASE_URL"]) if (!env[name]) env[name] = worker[name];
    } catch { console.log(JSON.stringify({ ready: false, code: "PRIVATE_WORKER_ENV_UNAVAILABLE" })); process.exitCode = 2; return; }
  }
  const result = await waveSpeedLivePreflight(env);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 2;
}
main().catch(() => { console.error(JSON.stringify({ ready: false, code: "WAVESPEED_PREFLIGHT_UNAVAILABLE" })); process.exitCode = 1; });
