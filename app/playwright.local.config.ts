import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/local-mode",
  workers: 1,
  timeout: 45000,
  use: { baseURL: "http://127.0.0.1:3102", headless: true, launchOptions: { channel: "msedge" } },
  reporter: [["list"]],
  outputDir: "./test-results/local-mode",
  webServer: {
    command: "node node_modules/next/dist/bin/next start -p 3102 -H 127.0.0.1",
    url: "http://127.0.0.1:3102",
    reuseExistingServer: false,
    timeout: 45000,
    env: { AUTH_ENABLED: "false", OUTREACH_QUEUE_ENABLED: "true", OUTREACH_DATABASE_URL: "", H3_BRIDGE_URL: "http://127.0.0.1:18788", CLIPPER_API_URL: "http://127.0.0.1:18765" },
  },
});
