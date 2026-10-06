import { defineConfig, devices } from "@playwright/test";

process.loadEnvFile(".env.local");
const testPort=Number(process.env.SAAS_TEST_PORT||3200);
if(!Number.isInteger(testPort)||testPort<1024||testPort>65535)throw new Error("Invalid SAAS_TEST_PORT");
const testBase=`http://127.0.0.1:${testPort}`;
process.env.SAAS_TEST_BASE_URL=testBase;
// Single-PC regressions remain local even when the operator enables remote signing.
process.env.APP_ENV="local";
process.env.APP_BASE_URL=testBase;
process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT="";
process.env.ENABLE_TEST_BILLING="1";
process.env.PAYMENT_PROVIDER="fake";
process.env.ENABLE_FAKE_PAYMENT_PROVIDER="1";
process.env.FAKE_PAYMENT_WEBHOOK_SECRET="isolated-local-fixture-webhook-secret-2026";
process.env.VIDEO_PROVIDER="fake";
process.env.ENABLE_FAKE_VIDEO_PROVIDER="1";
process.env.ENABLE_FAKE_CLIP_ANALYZER="1";
process.env.CLIP_ANALYZER_PROVIDER="fake";
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for browser tests");
if (!process.env.TEST_OBJECT_STORAGE_BUCKET) throw new Error("TEST_OBJECT_STORAGE_BUCKET is required for browser tests");
process.env.OBJECT_STORAGE_BUCKET=process.env.TEST_OBJECT_STORAGE_BUCKET;
process.env.OBJECT_STORAGE_ALLOWED_ORIGINS=testBase;
if(process.env.SAAS_TEST_STORAGE_PORT){
  const port=Number(process.env.SAAS_TEST_STORAGE_PORT);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("Invalid SAAS_TEST_STORAGE_PORT");
  process.env.OBJECT_STORAGE_ENDPOINT=`http://127.0.0.1:${port}`;
}

export default defineConfig({
  testDir: "./tests",
  outputDir:process.env.SAAS_TEST_OUTPUT_DIR||'test-results',
  testMatch: ["**/integration/*.spec.ts", "**/browser/*.spec.ts"],
  testIgnore:['**/phase9.spec.ts','**/remote-storage.spec.ts'],
  workers: 1,
  retries: 0,
  timeout: 90_000,
  use: { baseURL: testBase, ...devices["Desktop Chrome"], channel: "chrome", actionTimeout: 10_000 },
  globalSetup: "./tests/setup.ts",
  webServer: {
    command: `node node_modules/next/dist/bin/next dev -p ${testPort} -H 127.0.0.1`,
    url: `${testBase}/login`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: { SAAS_NEXT_DIST_DIR:process.env.SAAS_TEST_DIST_DIR||".next-tests", OBJECT_STORAGE_ENDPOINT:process.env.OBJECT_STORAGE_ENDPOINT!, OBJECT_STORAGE_PUBLIC_ENDPOINT:"", ENABLE_TEST_BILLING:"1",PAYMENT_PROVIDER:"fake",ENABLE_FAKE_PAYMENT_PROVIDER:"1",FAKE_PAYMENT_WEBHOOK_SECRET:process.env.FAKE_PAYMENT_WEBHOOK_SECRET!, DATABASE_URL: process.env.TEST_DATABASE_URL, OBJECT_STORAGE_BUCKET: process.env.TEST_OBJECT_STORAGE_BUCKET, APP_BASE_URL: testBase, APP_ENV: "local", MAIL_MODE: "development_file", VIDEO_PROVIDER: "fake", ENABLE_FAKE_VIDEO_PROVIDER: "1", ENABLE_FAKE_CLIP_ANALYZER: "1", CLIP_ANALYZER_PROVIDER:"fake" },
  },
});
