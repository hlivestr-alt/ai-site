import { defineConfig } from '@playwright/test';

if (!process.env.MASTER_QA_RUN_ID || !process.env.TEST_DATABASE_URL || !process.env.TEST_OBJECT_STORAGE_BUCKET) {
  throw new Error('Run through tests/master-acceptance/run.mjs for isolated resources.');
}
const baseURL = process.env.SAAS_TEST_BASE_URL!;
export default defineConfig({
  testDir: './tests/master-acceptance',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  outputDir: 'test-results/master-acceptance',
  reporter: [['line'], ['json', { outputFile: 'test-data/master-acceptance/playwright-results.json' }]],
  use: { baseURL, browserName: 'chromium', channel: 'chrome', actionTimeout: 12_000, navigationTimeout: 30_000, trace: 'off', screenshot: 'off' },
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev -p 3217 -H 127.0.0.1',
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'ignore',
    env: {
      ...process.env as Record<string, string>,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      OBJECT_STORAGE_BUCKET: process.env.TEST_OBJECT_STORAGE_BUCKET,
      SAAS_NEXT_DIST_DIR: '.next-tests/master-acceptance',
    },
  },
});
