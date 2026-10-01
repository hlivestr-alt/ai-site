import { defineConfig, devices } from "@playwright/test";

process.loadEnvFile(".env.local");
process.env.ENABLE_TEST_BILLING="1";
process.env.PAYMENT_PROVIDER="fake";
process.env.ENABLE_FAKE_PAYMENT_PROVIDER="1";
process.env.FAKE_PAYMENT_WEBHOOK_SECRET="isolated-local-fixture-webhook-secret-2026";
process.env.VIDEO_PROVIDER="fake";
process.env.ENABLE_FAKE_VIDEO_PROVIDER="1";
process.env.ENABLE_FAKE_CLIP_ANALYZER="1";
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for browser tests");
if (!process.env.TEST_OBJECT_STORAGE_BUCKET) throw new Error("TEST_OBJECT_STORAGE_BUCKET is required for browser tests");

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
    env: { ENABLE_TEST_BILLING:"1",PAYMENT_PROVIDER:"fake",ENABLE_FAKE_PAYMENT_PROVIDER:"1",FAKE_PAYMENT_WEBHOOK_SECRET:process.env.FAKE_PAYMENT_WEBHOOK_SECRET!, DATABASE_URL: process.env.TEST_DATABASE_URL, OBJECT_STORAGE_BUCKET: process.env.TEST_OBJECT_STORAGE_BUCKET, APP_BASE_URL: "http://127.0.0.1:3200", APP_ENV: "local", MAIL_MODE: "development_file", VIDEO_PROVIDER: "fake", ENABLE_FAKE_VIDEO_PROVIDER: "1", ENABLE_FAKE_CLIP_ANALYZER: "1" },
  },
});
