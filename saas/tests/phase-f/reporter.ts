import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter';
// Playwright's full JSON reporter includes webServer.env. Persist only acceptance facts.
export default class SafeReporter implements Reporter {
    private tests: {
        title: string;
        status: string;
        expectedStatus: string;
        duration: number;
        retry: number;
    }[] = [];
    constructor(private options: {
        outputFile: string;
    }) { }
    onTestEnd(test: TestCase, result: TestResult) { this.tests.push({ title: test.title, status: result.status, expectedStatus: test.expectedStatus, duration: result.duration, retry: result.retry }); void writeFile(dirname(this.options.outputFile)+'/live.json',JSON.stringify({completed:this.tests.length,passed:this.tests.filter(t=>t.status==='passed').length,failed:this.tests.filter(t=>t.status==='failed').length,lastTest:test.title})).catch(()=>{}); }
    async onEnd(result: FullResult) { await mkdir(dirname(this.options.outputFile), { recursive: true }); await writeFile(this.options.outputFile, JSON.stringify({ status: result.status, stats: { expected: this.tests.filter(t => t.status === t.expectedStatus).length, unexpected: this.tests.filter(t => t.status !== t.expectedStatus && t.status !== 'skipped').length, skipped: this.tests.filter(t => t.status === 'skipped').length, duration: result.duration }, tests: this.tests }, null, 2)); }
}
