import { createHash } from 'node:crypto';
import { pool, query } from '../../src/lib/db';
import { outreachProviderAudit } from '../../src/lib/outreach-provider-audit';
import { AppError } from '../../src/lib/core';
import type { Session } from '../../src/lib/auth';
import { beginAuthorization, authorizationCallback, verifyConnection, refreshConnection, disconnectRealChannel, authorizedChoices, chooseAuthorizedShop, providerFixtureEnabled, activeCredential, realChannel } from '../../src/lib/outreach-provider';
import { registerControlledRecipient, prepareCanary, approveCanary } from '../../src/lib/outreach-canary';
import { claimOutreach, executeOutreach, recoverOutreachLeases, outreachTick,finishOutreach } from '../../src/lib/outreach-worker';
async function session(email: string, w: string): Promise<Session> { const r = (await query("SELECT s.id,s.user_id,u.email,u.display_name,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1 AND s.revoked_at IS NULL AND s.expires_at>now() ORDER BY s.created_at DESC LIMIT 1", [email])).rows[0]; if (!r)
    throw new AppError(403, 'Fixture session unavailable.'); return { id: r.id, userId: r.user_id, email: r.email, displayName: r.display_name, expiresAt: r.expires_at, activeWorkspaceId: w }; }
async function status(action: () => Promise<unknown>) { try {
    await action();
    return 200;
}
catch (e) {
    return e instanceof AppError ? e.status : 503;
} }
async function main() {
    if (!providerFixtureEnabled())
        throw new Error('Owned provider fixture required.');
    const [action, email, w, id, arg] = process.argv.slice(2);
    let result: unknown;
    try {
        const actor = email ? await session(email, w) : null;
        if (action === 'connect' || action === 'deny-internal') {
            if (action === 'deny-internal') {
                const f = (await query('SELECT external_identity FROM outreach_provider_fixtures WHERE channel_id=$1', [id])).rows[0];
                process.env.OUTREACH_INTERNAL_ACCOUNT_FINGERPRINTS = createHash('sha256').update(JSON.stringify({ provider: 'TIKTOK_SHOP', account: f.external_identity })).digest('hex');
            }
            const started = await beginAuthorization(actor!, w, id);
            const state = new URL(started.authorizationUrl).searchParams.get('state')!;
            result = await authorizationCallback(actor!, state, 'fixture_code');
        }
        else if (action === 'callbacks') {
            const start = await beginAuthorization(actor!, w, id), state = new URL(start.authorizationUrl).searchParams.get('state')!, other = await session(arg, w);
            const badState = await status(() => authorizationCallback(actor!, 'x'.repeat(43), 'fixture_code'));
            const wrongSession = await status(() => authorizationCallback(other, state, 'fixture_code'));
            const next = await beginAuthorization(actor!, w, id), nextState = new URL(next.authorizationUrl).searchParams.get('state')!;
            const superseded = await status(() => authorizationCallback(actor!, state, 'fixture_code'));
            const current = await status(() => authorizationCallback(actor!, nextState, 'fixture_code'));
            const replay = await status(() => authorizationCallback(actor!, nextState, 'fixture_code'));
            const expiry = await beginAuthorization(actor!, w, id), expiryState = new URL(expiry.authorizationUrl).searchParams.get('state')!;
            await query("UPDATE outreach_oauth_states SET expires_at=now()-interval '1 second' WHERE state_hash=$1", [createHash('sha256').update(expiryState).digest('hex')]);
            const expired = await status(() => authorizationCallback(actor!, expiryState, 'fixture_code'));
            const final = await beginAuthorization(actor!, w, id);
            await authorizationCallback(actor!, new URL(final.authorizationUrl).searchParams.get('state')!, 'fixture_code');
            result = { badState, wrongSession, superseded, current, replay, expired };
        }
        else if (action === 'audit')
            result = await outreachProviderAudit(actor!, w);
        else if (action === 'verify')
            result = await verifyConnection(actor!, w, id);
        else if(action==='selection'){const choices=await authorizedChoices(actor!,w,id),invalid=await status(()=>chooseAuthorizedShop(actor!,w,id,'f'.repeat(64)));const selected=await status(()=>chooseAuthorizedShop(actor!,w,id,choices[0]?.choice||'')),replayed=await status(()=>chooseAuthorizedShop(actor!,w,id,choices[0]?.choice||''));result={choices:choices.length,publicMetadataSafe:choices.every(c=>!c.label.includes('fixture_')),invalid,selected,replayed};}
        else if (action === 'refresh')
            result = await refreshConnection(actor!, w, id);
        else if (action === 'disconnect')
            result = await disconnectRealChannel(actor!, w, id);
        else if (action === 'recipient')
            result = await registerControlledRecipient(actor!, w, id, 'controlled_creator_open_id');
        else if (action === 'prepare')
            result = await prepareCanary(actor!, w, JSON.parse(arg));
        else if (action === 'approve')
            result = await approveCanary(actor!, w, id);
        else if (action === 'audit-storage') {
            const c = await realChannel({ query }, w, id), k = await activeCredential(c);
            const rows = (await query('SELECT ciphertext,key_version FROM outreach_channel_credentials WHERE channel_id=$1', [id])).rows;
            const envelopeOnly = rows.every(r => Buffer.isBuffer(r.ciphertext) && !r.ciphertext.includes(Buffer.from(k.accessToken)) && !r.ciphertext.includes(Buffer.from(k.refreshToken)));
            const safeColumns = (await query("SELECT column_name FROM information_schema.columns WHERE table_name IN('outreach_channels','outreach_channel_credentials','outreach_credential_versions') AND column_name IN('access_token','refresh_token','app_secret')")).rowCount === 0;
            result = { envelopeOnly, safeColumns, keyVersion: rows[0].key_version, serverDecryption: true };
        }
        else if(action==='disconnect-claimed'){const d=await claimOutreach();if(!d)throw new AppError(409,'No fixture delivery.');await disconnectRealChannel(actor!,w,d.channel_id);const outcome=await executeOutreach(d);await finishOutreach(d,outcome);result={state:outcome.state};}
        else if (action === 'provider-before-completion') {
            const d = await claimOutreach();
            if (!d)
                throw new AppError(409, 'No fixture delivery available.');
            const outcome = await executeOutreach(d);
            result = { id: d.id, state: outcome.state, proofStored: !!(await query('SELECT 1 FROM outreach_provider_proofs WHERE delivery_id=$1', [d.id])).rowCount };
        }
        else if (action === 'tick')
            result = { processed: await outreachTick() };
        else if (action === 'recover')
            result = { recovered: await recoverOutreachLeases() };
        else
            throw new AppError(400, 'Unknown fixture action.');
        console.log(JSON.stringify(result));
    }
    catch (e) {
        console.log(JSON.stringify({ status: e instanceof AppError ? e.status : 503, code: e instanceof AppError ? e.safeCode || 'FIXTURE_ACTION_REJECTED' : 'FIXTURE_ACTION_UNAVAILABLE' }));
    }
    finally {
        await pool().end();
    }
}
void main();
