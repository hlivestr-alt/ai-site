import type { RunnerCapabilities, RunnerHealth } from "./types";

const modes = ["shadow", "canary", "two-job-canary", "production"] as const;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parseCapabilities(value: unknown): RunnerCapabilities {
  if (!record(value) || typeof value.runnerVersion !== "string" || !value.runnerVersion || value.bundleSchemaVersion !== 1 || !modes.includes(value.mode as RunnerCapabilities["mode"]) || typeof value.generationEnabled !== "boolean" || !(value.maxJobsPerSession === null || Number.isInteger(value.maxJobsPerSession))) {
    throw new Error("Unexpected H3 capabilities response.");
  }
  return { runnerVersion: value.runnerVersion, bundleSchemaVersion: 1, mode: value.mode as RunnerCapabilities["mode"], generationEnabled: value.generationEnabled, maxJobsPerSession: value.maxJobsPerSession as number | null };
}

export function parseHealth(value: unknown): RunnerHealth {
  if (!record(value) || typeof value.ready !== "boolean" || !modes.includes(value.mode as RunnerHealth["mode"])) throw new Error("Unexpected H3 health response.");
  return { ready: value.ready, mode: value.mode as RunnerHealth["mode"] };
}
