import { defineConfig, devices } from "@playwright/test";

process.loadEnvFile(".env.local");
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for browser tests");

export default defineConfig({
  testDir: "./tests",
  testMatch: ["**/integration/*.spec.ts", "**/browser/*.spec.ts"],
  workers: 1,
  retries: 0,
  timeout: 90_000,
  use: { baseURL: "http://127.0.0.1:3200", ...devices["Desktop Chrome"], channel: "chrome", actionTimeout: 10_000 },
  globalSetup: "./tests/setup.ts",
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3200/login",
    reuseExistingServer: false,
    timeout: 90_000,
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL, APP_BASE_URL: "http://127.0.0.1:3200", APP_ENV: "local", MAIL_MODE: "development_file" },
  },
});
