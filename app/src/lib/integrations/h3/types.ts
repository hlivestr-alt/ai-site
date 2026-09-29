export type H3ConnectionState = "connected" | "unavailable" | "misconfigured";

/** Browser-safe summary. No runner URL, file path, or raw response is exposed. */
export interface H3ConnectionStatus {
  state: H3ConnectionState;
  message: string;
  runnerMode: "shadow" | "canary" | "two-job-canary" | "production" | null;
  generationAvailable: false;
  reason: string;
  checkedAt: string;
}

export interface RunnerCapabilities {
  runnerVersion: string;
  bundleSchemaVersion: number;
  mode: "shadow" | "canary" | "two-job-canary" | "production";
  generationEnabled: boolean;
  maxJobsPerSession: number | null;
}

export interface RunnerHealth {
  ready: boolean;
  mode: RunnerCapabilities["mode"];
}
