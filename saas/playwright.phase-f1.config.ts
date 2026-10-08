import { defineConfig, devices } from '@playwright/test';
if (!process.env.STABILIZATION_RUN_ID || !process.env.DATABASE_URL?.includes('/phase_e_') || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL || !process.env.OBJECT_STORAGE_BUCKET?.startsWith('phase-e-'))
    throw new Error('Owned Phase F isolated fixtures are required.');
const suite = process.env.STABILIZATION_SUITE!, base = process.env.SAAS_TEST_BASE_URL!, port = Number(process.env.SAAS_TEST_PORT), directory = `test-data/phase-f1/${suite}`;
const group = ['outreach', 'outreach-browser', 'outreach-restart'].includes(suite) ? 'phase-e' : ['variations', 'editor', 'restart-variation', 'isolation'].includes(suite) ? 'phase-d' : suite === 'shared' ? 'phase-c' : suite === 'phase-b' ? 'phase-b' : suite === 'integration' ? 'integration' : ['browser', 'browser-retry'].includes(suite) ? 'browser' : 'stabilization';
export default defineConfig({
    testDir: suite.startsWith('router') || suite.startsWith('provider') || suite === 'canary-browser' ? './tests/phase-f1' : ['browser','browser-retry'].includes(suite)?'.next-tests/phase-f1-regressions/tests':`.next-tests/phase-f1-regressions/tests/${group}`,
    testMatch: ['browser','browser-retry'].includes(suite)?['**/integration/*.spec.ts','**/browser/*.spec.ts']:'**/*.spec.ts', testIgnore: ['**/phase9.spec.ts', '**/remote-storage.spec.ts'], outputDir: directory + '/artifacts', workers: 1, retries: 0, timeout: 180000,
    reporter: suite.startsWith('router')?[[ './tests/phase-f1/reporter.ts', { outputFile: directory + '/playwright.json' }]]:[['line'], ['./tests/phase-f1/reporter.ts', { outputFile: directory + '/playwright.json' }]],
    use: { ...devices['Desktop Chrome'], baseURL: base, channel: 'chrome', actionTimeout: 15000, trace: 'off', screenshot: 'off' }, globalSetup: './tests/setup.ts',
    webServer: { command: `node node_modules/next/dist/bin/next dev -p ${port} -H 127.0.0.1`, url: base + '/login', timeout: 90000, reuseExistingServer: false, stdout: suite.startsWith('router')?'pipe':'ignore', stderr: suite.startsWith('router')?'pipe':'ignore', env: { ...process.env, SAAS_NEXT_DIST_DIR: `.next-tests/phase-f1-${port}` } as Record<string, string> }
});
