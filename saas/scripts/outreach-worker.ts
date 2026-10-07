import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { AppError } from '../src/lib/core';
import { testOutreachEnabled } from '../src/lib/outreach';
import { outreachHeartbeat, recoverOutreachLeases, claimOutreach, fakeSend, finishOutreach, outreachSettlementBatch } from '../src/lib/outreach-worker';
import { pool } from '../src/lib/db';
async function main() {
    if (!testOutreachEnabled())
        throw new Error('Only an isolated Phase E TEST provider/database may run this worker.');
    const workerId = randomUUID();
    let running = true;
    process.on('SIGTERM', () => { running = false; });
    process.on('SIGINT', () => { running = false; });
    async function fault(stage: string, id: string | null) { if (process.env.PHASE_E_PROCESS_TEST !== '1' || process.env.PHASE_E_PAUSE_STAGE !== stage)
        return; const dir = process.env.PHASE_E_FAULT_DIR; if (!dir || !resolve(dir).startsWith(resolve('test-data/phase-e') + sep))
        throw new Error('Owned Phase E fault directory required.'); await mkdir(dir, { recursive: true }); await writeFile(resolve(dir, 'paused.json'), JSON.stringify({ stage, deliveryId: id })); while (running)
        await wait(100); }
    try {
        while (running) {
            await outreachHeartbeat(workerId);
            await recoverOutreachLeases();
            await outreachSettlementBatch();
            await fault('before_claim', null);
            if (!running)
                break;
            const d = await claimOutreach();
            if (d) {
                await fault('after_claim', d.id);
                if (!running)
                    break;
                const outcome = await fakeSend(d);
                await fault('after_provider', d.id);
                await finishOutreach(d, outcome, true);
                await fault('after_completion', d.id);
                await outreachSettlementBatch();
            }
            if (process.argv.includes('--once'))
                break;
            await wait(100);
        }
    }
    catch (e) {
        console.error(JSON.stringify({ component: 'outreach-worker', code: e instanceof AppError ? e.safeCode || `HTTP_${e.status}` : 'OUTREACH_WORKER_STOPPED' }));
        process.exitCode = 1;
    }
    finally {
        await pool().end();
    }
}
void main();
