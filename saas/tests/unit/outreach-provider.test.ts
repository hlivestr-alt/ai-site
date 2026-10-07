import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { sealCredential, openCredential, providerSignature, retryAfter, TikTokShopProvider, OutreachProviderError, MESSAGE_SCOPE, DIRECTORY_SCOPE, type Transport, type SellerCredential } from '../../src/lib/outreach-provider-core';
const credential: SellerCredential = { accessToken: 'unit_access_private', refreshToken: 'unit_refresh_private', shopCipher: 'unit_cipher_private', shopId: 'unit_shop', shopName: 'QA', sellerId: 'unit_seller', scopes: [MESSAGE_SCOPE, DIRECTORY_SCOPE], accessExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshExpiresAt: new Date(Date.now() + 86400000).toISOString() };
const provider = (transport: Transport) => new TikTokShopProvider({ appKey: 'unit_app', appSecret: 'unit_private_secret', transport });
const response = (data: unknown, code = 0, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify({ code, data, request_id: 'unit_request' }), { status, headers });
test('F encryption authenticates tenant, channel, identity and generation; retains versioned key access', () => {
    const keys = { '1': randomBytes(32).toString('hex'), '2': randomBytes(32).toString('hex') }, context = 'workspace/channel/account/1';
    const a = sealCredential(credential, keys, 1, context), b = sealCredential(credential, keys, 1, context);
    assert.notDeepEqual(a, b);
    assert.equal(a.includes(Buffer.from(credential.accessToken)), false);
    assert.deepEqual(openCredential(a, keys, 1, context), credential);
    for (const context2 of ['foreign/channel/account/1', 'workspace/foreign/account/1', 'workspace/channel/foreign/1', 'workspace/channel/account/2'])
        assert.throws(() => openCredential(a, keys, 1, context2), /cannot be authenticated/);
    assert.throws(() => openCredential(a, keys, 2, context));
    assert.throws(() => openCredential(a, { '2': keys['2'] }, 1, context));
    const tampered = Buffer.from(a);
    tampered[tampered.length - 1] ^= 1;
    assert.throws(() => openCredential(tampered, keys, 1, context));
    assert.deepEqual(openCredential(sealCredential(credential, keys, 2, context), keys, 2, context), credential);
});
test('F signing uses path, sorted parameters and exact body, excluding transport sign/access token', () => {
    const body = '{"content":"QA"}', secret = 'unit_signing_secret', path = '/messages';
    assert.equal(providerSignature(path, { z: 2, a: 1, sign: 'excluded', access_token: 'excluded' }, body, secret), createHmac('sha256', secret).update(secret + path + 'a1z2' + body + secret).digest('hex'));
    assert.notEqual(providerSignature(path, { a: 1, z: 2 }, body, secret), providerSignature(path, { a: 1, z: 2 }, body + ' ', secret));
});
test('F Retry-After preserves long delays and HTTP dates without unsafe short clipping', () => {
    assert.equal(retryAfter('3600'), 3600000);
    assert.equal(retryAfter('0.25'), 250);
    assert.equal(retryAfter('Wed, 07 Oct 2026 12:00:00 GMT', Date.parse('2026-10-07T11:00:00Z')), 3600000);
    assert.equal(retryAfter('invalid'), undefined);
    assert.equal(retryAfter('-1'), undefined);
});
test('F token exchange validates seller type, absolute expiry and required data without exposing provider failures', async () => {
    for (const patch of [{ user_type: 1 }, { access_token_expire_in: 1 }, { refresh_token: '' }, { open_id: '???' }]) {
        const p = provider(async () => response({ access_token: credential.accessToken, refresh_token: credential.refreshToken, access_token_expire_in: Math.floor(Date.now() / 1000) + 3600, refresh_token_expire_in: Math.floor(Date.now() / 1000) + 86400, user_type: 0, open_id: 'qa_seller', granted_scopes: [MESSAGE_SCOPE], ...patch }));
        let error: unknown;
        try {
            await p.tokens('unit_code');
        }
        catch (e) {
            error = e;
        }
        assert.ok(error instanceof OutreachProviderError);
        assert.equal(String(error).includes(credential.accessToken), false);
    }
});
for (const [label, transport, state] of [
    ['accepted ID', async () => response({ message_id: 'unit_message' }), 'SENT'],
    ['missing ID', async () => response({}), 'DELIVERY_UNKNOWN'],
    ['5xx with rejection', async () => response({}, 16030100, 503), 'DELIVERY_UNKNOWN'],
    ['timeout', async () => { throw new Error(credential.accessToken); }, 'DELIVERY_UNKNOWN'],
    ['malformed rate response', async () => new Response('unparseable', { status: 429 }), 'DELIVERY_UNKNOWN'],
    ['restricted', async () => response({}, 16030100), 'RESTRICTED'],
    ['definite rejection', async () => response({}, 999999), 'FAILED'],
    ['structured rate rejection', async () => response({}, 36009002, 429, { 'retry-after': '3600' }), 'FAILED'],
    ['ID echoes credential', async () => response({ message_id: credential.accessToken }), 'DELIVERY_UNKNOWN']
] as const) {
    test(`F send classification: ${label}`, async () => {
        let calls = 0;
        const p = provider(async (u, i) => { calls++; assert.equal(u.origin, 'https://open-api.tiktokglobalshop.com'); assert.equal(i.redirect, 'error'); return transport(); });
        const outcome = await p.message(credential, 'unit_conversation', 'Controlled QA message');
        assert.equal(outcome.state, state);
        assert.equal(calls, 1);
        assert.equal(JSON.stringify(outcome).includes(credential.accessToken), false);
        if (label === 'structured rate rejection')
            assert.equal(outcome.retryAfterMs, 3600000);
    });
}
test('F 401/403 requires reauthorization and never retries HTTP', async () => {
    for (const status of [401, 403]) {
        let calls = 0;
        const p = provider(async () => { calls++; return response({}, 105002, status); });
        await assert.rejects(p.message(credential, 'unit_conversation', 'QA'), e => e instanceof OutreachProviderError && ['AUTH', 'PERMISSION'].includes(e.category));
        assert.equal(calls, 1);
    }
});
test('F public shop choices reject echoed credentials and malformed identity metadata', async () => {
    const p = provider(async () => response({ shops: [{ id: 'qa_shop', name: credential.accessToken, cipher: 'safe_cipher', region: 'ID' }] }));
    await assert.rejects(p.shops(credential.accessToken), OutreachProviderError);
});
