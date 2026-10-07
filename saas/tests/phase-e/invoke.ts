import { AppError } from '../../src/lib/core';
import { pool } from '../../src/lib/db';
import { testOutreachEnabled } from '../../src/lib/outreach';
import { outreachTick, claimOutreach, recoverOutreachLeases, finishOutreach, fakeSend, outreachSettlementBatch } from '../../src/lib/outreach-worker';
async function main() {
    if (!testOutreachEnabled())
        throw new Error('Owned E environment required');
    let result: unknown;
    try {
        const action = process.argv[2];
        if (action === 'tick')
            result = { processed: await outreachTick() };
        else if (action === 'claim') {
            const d = await claimOutreach();
            result = d ? { id: d.id, workspace_id: d.workspace_id, campaign_id: d.campaign_id, channel_id: d.channel_id, lease_id: d.lease_id } : null;
        }
        else if (action === 'recover')
            result = { recovered: await recoverOutreachLeases() };
        else if (action === 'settle')
            result = { settled: await outreachSettlementBatch() };
        else if (action === 'finish') {
            const d = JSON.parse(process.argv[3]);
            const current = (await pool().query("SELECT d.*,r.frozen_message,r.message_hash FROM outreach_deliveries d JOIN outreach_recipients r ON r.id=d.recipient_id WHERE d.id=$1", [d.id])).rows[0];
            current.lease_id = d.lease_id;
            result = { finished: await finishOutreach(current, await fakeSend(current)) };
        }
        else
            throw new Error('Unknown controlled probe');
        console.log(JSON.stringify(result));
    }
    catch (e) {
        if (e instanceof AppError)
            console.log(JSON.stringify({ status: e.status }));
        else
            throw e;
    }
    finally {
        await pool().end();
    }
}
void main();
