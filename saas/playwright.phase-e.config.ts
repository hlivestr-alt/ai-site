import { defineConfig, devices } from '@playwright/test';
if (!process.env.STABILIZATION_RUN_ID || !process.env.DATABASE_URL?.includes('/phase_e_') || !process.env.OBJECT_STORAGE_BUCKET?.startsWith('phase-e-'))
    throw new Error('Owned Phase E isolation is required');
const suite = process.env.STABILIZATION_SUITE!, base = process.env.SAAS_TEST_BASE_URL!, port = Number(process.env.SAAS_TEST_PORT), directory = `test-data/phase-e/${suite}`;
export default defineConfig({
    testDir: ['outreach', 'outreach-browser', 'outreach-restart'].includes(suite) ? './tests/phase-e' : ['variations', 'editor', 'restart-variation', 'isolation'].includes(suite) ? './tests/phase-d' : suite === 'shared' ? './tests/phase-c' : suite === 'phase-b' ? './tests/phase-b' : './tests/stabilization', testMatch: '**/*.spec.ts', outputDir: directory + '/artifacts', workers: 1, retries: 0, timeout: 180000,
    reporter: [['line'], ['./tests/phase-e/reporter.ts', { outputFile: directory + '/playwright.json' }]], use: { ...devices['Desktop Chrome'], baseURL: base, channel: 'chrome', actionTimeout: 15000, trace: 'off', screenshot: 'off' }, globalSetup: './tests/setup.ts',
    webServer: { command: `node node_modules/next/dist/bin/next dev -p ${port} -H 127.0.0.1`, url: base + '/login', timeout: 90000, reuseExistingServer: false, stdout: 'ignore', stderr: 'ignore', env: { ...process.env, SAAS_NEXT_DIST_DIR: `.next-tests/phase-e-${port}` } as Record<string, string> }
});
