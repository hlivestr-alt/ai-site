import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import type { Session } from './auth';
import { query, transaction, type DbClient } from './db';
import { AppError, audit } from './core';
import { requireActiveWorkspace } from './products';
import { canonicalHash } from './billing-core';
import { allowlistedOperator } from './platform-access';
import { channelFor, testOutreachEnabled, type Channel } from './outreach';
import { TikTokShopProvider, OutreachProviderError, MESSAGE_SCOPE, DIRECTORY_SCOPE, sealCredential, openCredential, type SellerCredential, type AuthorizedShop, type Transport } from './outreach-provider-core';
export type RealChannel = Channel & {
  provider_identity: string | null;
  granted_scopes: string[];
  credential_reference: string | null;
  credential_version: number;
  authorization_realm: 'UNCONFIGURED' | 'REAL' | 'TEST_FIXTURE';
  certification: string;
  access_expires_at: Date | null;
  refresh_expires_at: Date | null;
  verified_at: Date | null;
  safe_connection_code: string | null;
  refresh_lease: string | null;
  refresh_lease_expires_at: Date | null;
  provider_blocked_until: Date | null;
  authorization_state_hash: string | null;
};
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export function providerFixtureEnabled() {
  return testOutreachEnabled() && process.env.OUTREACH_PROVIDER_FIXTURE === '1';
}
export function providerConfiguration() {
  const fixture = providerFixtureEnabled(),
    exclusions = (process.env.OUTREACH_INTERNAL_ACCOUNT_FINGERPRINTS || '').split(',').map(v => v.trim()).filter(Boolean),
    cryptoReady = (() => {
      try {
        keyring();
        return true;
      } catch {
        return false;
      }
    })(),
    configured = cryptoReady && (process.env.OUTREACH_PROVIDER_FIXTURE !== '1' || fixture) && (fixture || process.env.OUTREACH_TIKTOK_CONTRACT_REVIEWED === '1' && !!process.env.OUTREACH_TIKTOK_APP_KEY && !!process.env.OUTREACH_TIKTOK_APP_SECRET && !!process.env.OUTREACH_TIKTOK_SERVICE_ID && !!process.env.OUTREACH_CREDENTIAL_KEYS && exclusions.length > 0 && exclusions.every(v => /^[a-f0-9]{64}$/.test(v)));
  return {
    fixture,
    configured,
    realSending: process.env.OUTREACH_ENABLED !== '0' && process.env.OUTREACH_REAL_SEND_ENABLED === '1' && configured,
    bulkSending: false
  };
}
function keyring() {
  try {
    const values = JSON.parse(process.env.OUTREACH_CREDENTIAL_KEYS || '{}') as Record<string, string>,
      version = Number(process.env.OUTREACH_CREDENTIAL_KEY_VERSION);
    if (!Number.isSafeInteger(version) || version < 1 || !/^[a-f0-9]{64}$/i.test(values[String(version)] || '')) throw new Error();
    return {
      values,
      version
    };
  } catch {
    throw new AppError(503, 'Outbound account encryption is not configured.');
  }
}
function configured() {
  if (!providerConfiguration().configured) throw new AppError(503, 'Account activation is pending. Contact support to configure the authorized provider application.');
  keyring();
}
function credentialContext(c: RealChannel, version: number) {
  return JSON.stringify(['OUTREACH_CREDENTIAL_V1', c.workspace_id, c.id, c.provider_identity, version]);
}
function pendingContext(s: {
  workspace_id: string;
  channel_id: string;
  actor_id: string;
  session_id: string;
  state_hash: string;
}) {
  return JSON.stringify(['OUTREACH_AUTHORIZATION_V1', s.workspace_id, s.channel_id, s.actor_id, s.session_id, s.state_hash]);
}
export async function realChannel(db: DbClient, w: string, id: string, locked = false) {
  const c = (await channelFor(db, w, id, locked)) as RealChannel;
  if (c.provider !== 'TIKTOK_SHOP') throw new AppError(409, 'Choose a TikTok Shop account.');
  return c;
}
export function realChannelSendable(c: RealChannel) {
  const configuration = providerConfiguration();
  return configuration.realSending && !(process.env.OUTREACH_INTERNAL_ACCOUNT_FINGERPRINTS || '').split(',').map(v => v.trim()).includes(hash(JSON.stringify({
    provider: 'TIKTOK_SHOP',
    account: c.provider_identity
  }))) && c.status === 'CONNECTED' && c.outbound_capable && c.granted_scopes.includes(MESSAGE_SCOPE) && !!c.credential_reference && !!c.provider_identity && !!c.access_expires_at && c.access_expires_at.getTime() > Date.now() + 30000 && !c.refresh_lease && (!c.provider_blocked_until || c.provider_blocked_until.getTime() <= Date.now()) && (c.authorization_realm === 'REAL' || c.authorization_realm === 'TEST_FIXTURE' && configuration.fixture);
}
async function fixtureTransport(c: RealChannel): Promise<Transport> {
  if (!providerFixtureEnabled() || c.authorization_realm !== 'TEST_FIXTURE') throw new AppError(503, 'Provider fixture transport is unavailable.');
  return async (url, init) => {
    const f = (await query<{
      external_identity: string;
      scenario: string;
    }>('UPDATE outreach_provider_fixtures SET api_calls=api_calls+1 WHERE workspace_id=$1 AND channel_id=$2 RETURNING external_identity,scenario', [c.workspace_id, c.id])).rows[0];
    if (!f) throw new OutreachProviderError('FAILED');
    const envelope = (data: unknown, code = 0, status = 200) => new Response(JSON.stringify({
      code,
      data,
      request_id: 'fixture-request'
    }), {
      status,
      headers: {
        'content-type': 'application/json'
      }
    });
    if (url.pathname.includes('/token/')) {
      if (url.pathname.endsWith('/refresh')) await query('UPDATE outreach_provider_fixtures SET refresh_calls=refresh_calls+1 WHERE channel_id=$1', [c.id]);
      if (f.scenario === 'REFRESH_UNKNOWN') throw new Error('Fixture network response unavailable');
      if (['EXPIRED', 'REVOKED'].includes(f.scenario)) return envelope({}, 105002, 401);
      const generation = c.credential_version + 1;
      return envelope({
        access_token: `fixture_access_${c.id}_${generation}`,
        refresh_token: `fixture_refresh_${c.id}_${generation}`,
        access_token_expire_in: Math.floor(Date.now() / 1000) + 3600,
        refresh_token_expire_in: Math.floor(Date.now() / 1000) + 86400,
        user_type: 0,
        open_id: 'fixture_seller',
        granted_scopes: f.scenario === 'BAD_SCOPE' ? [DIRECTORY_SCOPE] : [MESSAGE_SCOPE, DIRECTORY_SCOPE]
      });
    }
    if (['EXPIRED', 'REVOKED', 'UNAUTHORIZED'].includes(f.scenario)) return envelope({}, 105002, 401);
    if (url.pathname === '/authorization/202309/shops') return envelope({
      shops: [{
        id: f.external_identity,
        name: 'Controlled QA shop',
        cipher: `fixture_cipher_${c.id}`,
        region: 'ID'
      }, ...(f.scenario === 'MULTI_SHOP' ? [{
        id: f.external_identity + '_second',
        name: 'Second controlled QA shop',
        cipher: `fixture_second_cipher_${c.id}`,
        region: 'ID'
      }] : [])]
    });
    if (url.pathname.includes('/marketplace_creators/')) return envelope({
      creator_open_id: url.pathname.split('/').at(-1),
      nickname: 'Controlled QA recipient',
      username: 'controlled_qa',
      follower_count: 1000
    });
    if (url.pathname === '/affiliate_seller/202508/conversations') {
      if (['RATE_LIMIT', 'RATE_LIMIT_LONG'].includes(f.scenario) && !(await query('SELECT 1 FROM outreach_provider_fixtures WHERE channel_id=$1 AND api_calls>1', [c.id])).rowCount) return new Response(JSON.stringify({
        code: 36009002
      }), {
        status: 429,
        headers: {
          'retry-after': f.scenario === 'RATE_LIMIT_LONG' ? '3600' : '2'
        }
      });
      return envelope({
        conversation_id: 'fixture_conversation'
      });
    }
    if (init.method === 'POST' && url.pathname.endsWith('/messages')) {
      await query('UPDATE outreach_provider_fixtures SET message_calls=message_calls+1 WHERE channel_id=$1', [c.id]);
      if (f.scenario === 'UNKNOWN') throw new Error('Fixture response unavailable');
      if (f.scenario === 'RESTRICTED') return envelope({}, 16030100);
      if (f.scenario === 'FAILED') return envelope({}, 999999);
      if (f.scenario === 'MISSING_PROOF') return envelope({});
      return envelope({
        message_id: `fixture_message_${c.id}`
      });
    }
    throw new Error('Provider fixture operation rejected');
  };
}
export async function providerFor(c: RealChannel, beforeMessage?: () => Promise<void>) {
  configured();
  if (c.authorization_realm === 'TEST_FIXTURE') {
    if (!providerFixtureEnabled()) throw new AppError(503, 'Provider fixture is unavailable.');
    return new TikTokShopProvider({
      appKey: 'fixture_app',
      appSecret: 'fixture_app_secret',
      transport: await fixtureTransport(c),
      beforeRequest: () => waitForProviderPermit(c),
      beforeMessage
    });
  }
  if (c.authorization_realm !== 'REAL' || providerConfiguration().fixture) throw new AppError(409, 'Provider authorization realm does not match this deployment.');
  return new TikTokShopProvider({
    appKey: process.env.OUTREACH_TIKTOK_APP_KEY!,
    appSecret: process.env.OUTREACH_TIKTOK_APP_SECRET!,
    beforeRequest: () => waitForProviderPermit(c),
    beforeMessage
  });
}
export async function activeCredential(c: RealChannel, allowExpired = false) {
  if (!c.credential_reference || c.status !== 'CONNECTED' || c.refresh_lease || !allowExpired && (!c.access_expires_at || c.access_expires_at.getTime() <= Date.now() + 30000)) throw new AppError(409, 'This account needs reauthorization.');
  const row = (await query<{
    ciphertext: Buffer;
    key_version: number;
  }>('SELECT k.ciphertext,k.key_version FROM outreach_channel_credentials k JOIN outreach_credential_versions v ON v.credential_id=k.id WHERE k.id=$1 AND k.workspace_id=$2 AND k.channel_id=$3 AND v.status=\'ACTIVE\' AND v.version=$4 AND v.provider_identity=$5', [c.credential_reference, c.workspace_id, c.id, c.credential_version, c.provider_identity])).rows[0];
  if (!row) throw new AppError(409, 'Account credential ownership could not be verified.');
  try {
    const credential = openCredential<SellerCredential>(row.ciphertext, keyring().values, row.key_version, credentialContext(c, c.credential_version));
    if (credential.shopId !== c.provider_identity || !credential.accessToken || !credential.refreshToken || !credential.shopCipher || canonicalHash(credential.scopes) !== canonicalHash(c.granted_scopes) || new Date(credential.accessExpiresAt).getTime() !== c.access_expires_at?.getTime() || new Date(credential.refreshExpiresAt).getTime() !== c.refresh_expires_at?.getTime()) throw new Error('Credential attribution mismatch');
    return credential;
  } catch {
    throw new AppError(409, 'Account credentials need attention. Reconnect this account.');
  }
}
async function activate(db: DbClient, c: RealChannel, tokens: Omit<SellerCredential, 'shopId' | 'shopCipher' | 'shopName'>, shop: AuthorizedShop, actorId: string) {
  if ((process.env.OUTREACH_INTERNAL_ACCOUNT_FINGERPRINTS || '').split(',').map(v => v.trim()).includes(hash(JSON.stringify({
    provider: 'TIKTOK_SHOP',
    account: shop.id
  })))) throw new AppError(409, 'This provider account is reserved for internal infrastructure and cannot be connected.');
  if (c.provider_identity && c.provider_identity !== shop.id) throw new AppError(409, 'Reconnect the same authorized account. Account ownership cannot be reassigned.');
  if ([tokens.accessToken, tokens.refreshToken, process.env.OUTREACH_TIKTOK_APP_SECRET || ''].some(secret => secret && [shop.id, shop.name, shop.region, ...tokens.scopes].some(field => field.includes(secret)))) throw new AppError(409, 'Provider metadata could not be validated safely.');
  const {
      values,
      version: keyVersion
    } = keyring(),
    generation = c.credential_version + 1,
    id = randomUUID(),
    credential: SellerCredential = {
      ...tokens,
      shopId: shop.id,
      shopCipher: shop.cipher,
      shopName: shop.name
    };
  const bound = {
      ...c,
      provider_identity: shop.id
    },
    ciphertext = sealCredential(credential, values, keyVersion, credentialContext(bound, generation));
  await db.query("UPDATE outreach_credential_versions SET status='RETIRED',retired_at=now() WHERE channel_id=$1 AND status='ACTIVE'", [c.id]);
  await db.query('INSERT INTO outreach_channel_credentials(id,workspace_id,channel_id,credential_version,ciphertext,key_version) VALUES($1,$2,$3,$4,$5,$6)', [id, c.workspace_id, c.id, generation, ciphertext, keyVersion]);
  await db.query("INSERT INTO outreach_credential_versions(credential_id,workspace_id,channel_id,provider_identity,version,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [id, c.workspace_id, c.id, shop.id, generation]);
  const capable = tokens.scopes.includes(MESSAGE_SCOPE),
    state = capable ? 'CONNECTED' : 'NEEDS_REAUTH';
  await db.query('UPDATE outreach_channels SET provider_identity=$1,credential_reference=$2,credential_version=$3,granted_scopes=$4::jsonb,status=$5,outbound_capable=$6,connected_at=coalesce(connected_at,now()),verified_at=now(),access_expires_at=$7,refresh_expires_at=$8,refresh_lease=NULL,refresh_lease_expires_at=NULL,safe_connection_code=$9,certification=\'NOT_TESTED\',updated_at=now() WHERE id=$10', [shop.id, id, generation, JSON.stringify(tokens.scopes), state, capable, tokens.accessExpiresAt, tokens.refreshExpiresAt, capable ? null : 'MISSING_SEND_SCOPE', c.id]);
  await audit(db, {
    workspaceId: c.workspace_id,
    actorUserId: actorId,
    type: capable ? 'OUTREACH_CHANNEL_CONNECTED' : 'OUTREACH_CHANNEL_NEEDS_REAUTH',
    targetType: 'outreach_channel',
    targetId: c.id,
    metadata: {
      provider: 'TIKTOK_SHOP',
      credentialVersion: generation,
      fixture: c.authorization_realm === 'TEST_FIXTURE'
    }
  });
}
export async function beginAuthorization(session: Session, w: string, id: string) {
  await requireActiveWorkspace(session, w, 'outreach:channel_manage');
  configured();
  return transaction(async db => {
    await requireActiveWorkspace(session, w, 'outreach:channel_manage', db);
    await realChannel(db, w, id, true);
    if ((await db.query("SELECT 1 FROM outreach_deliveries WHERE channel_id=$1 AND state IN('DISPATCHING','DELIVERY_UNKNOWN') LIMIT 1", [id])).rowCount) throw new AppError(409, 'Resolve active or uncertain deliveries before reconnecting.');
    await db.query('UPDATE outreach_oauth_states SET finished_at=coalesce(finished_at,now()),pending_ciphertext=NULL,pending_key_version=NULL WHERE workspace_id=$1 AND channel_id=$2 AND finished_at IS NULL', [w, id]);
    const state = randomBytes(32).toString('base64url'),
      expiresAt = new Date(Date.now() + 600000),
      realm = providerFixtureEnabled() ? 'TEST_FIXTURE' : 'REAL';
    await db.query('INSERT INTO outreach_oauth_states(state_hash,workspace_id,channel_id,actor_id,session_id,expires_at) VALUES($1,$2,$3,$4,$5,$6)', [hash(state), w, id, session.userId, session.id, expiresAt]);
    await db.query("UPDATE outreach_channels SET status='PENDING',outbound_capable=false,authorization_realm=$1,safe_connection_code=NULL,authorization_state_hash=$3,refresh_lease=NULL,refresh_lease_expires_at=NULL,updated_at=now() WHERE id=$2", [realm, id, hash(state)]);
    await audit(db, {
      workspaceId: w,
      actorUserId: session.userId,
      type: 'OUTREACH_CHANNEL_CONNECT_STARTED',
      targetType: 'outreach_channel',
      targetId: id
    });
    const url = new URL('https://services.tiktokshop.com/open/authorize');
    url.searchParams.set('service_id', providerFixtureEnabled() ? 'fixture_service' : process.env.OUTREACH_TIKTOK_SERVICE_ID!);
    url.searchParams.set('state', state);
    return {
      authorizationUrl: url.href,
      expiresAt
    };
  });
}
type Authorization = {
  state_hash: string;
  workspace_id: string;
  channel_id: string;
  actor_id: string;
  session_id: string;
  expires_at: Date;
  consumed_at: Date | null;
  pending_ciphertext: Buffer | null;
  pending_key_version: number | null;
  finished_at: Date | null;
};
export async function authorizationCallback(session: Session, state: string, code: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4096) throw new AppError(400, 'Authorization could not be verified. Start a new connection.');
  const s = await transaction(async db => {
    const initial = (await db.query<Authorization>('SELECT * FROM outreach_oauth_states WHERE state_hash=$1', [hash(state)])).rows[0];
    if (!initial || initial.actor_id !== session.userId || initial.session_id !== session.id) throw new AppError(400, 'Authorization belongs to another session.');
    await realChannel(db, initial.workspace_id, initial.channel_id, true);
    const row = (await db.query<Authorization>('SELECT * FROM outreach_oauth_states WHERE state_hash=$1 FOR UPDATE', [hash(state)])).rows[0];
    if (!row || row.actor_id !== session.userId || row.session_id !== session.id || row.expires_at.getTime() <= Date.now() || row.consumed_at || row.finished_at) throw new AppError(400, 'Authorization expired, was used, or belongs to another session.');
    await requireActiveWorkspace(session, row.workspace_id, 'outreach:channel_manage', db);
    await db.query('UPDATE outreach_oauth_states SET consumed_at=now() WHERE state_hash=$1', [row.state_hash]);
    return row;
  });
  const c = await realChannel({
      query
    }, s.workspace_id, s.channel_id),
    provider = await providerFor(c);
  try {
    const tokens = await provider.tokens(code),
      shops = await provider.shops(tokens.accessToken);
    const {
      values,
      version
    } = keyring();
    await transaction(async db => {
      await requireActiveWorkspace(session, s.workspace_id, 'outreach:channel_manage', db);
      const current = await realChannel(db, s.workspace_id, s.channel_id, true);
      if (current.status !== 'PENDING' || current.authorization_state_hash !== s.state_hash) throw new AppError(409, 'This authorization was superseded.');
      if (shops.length === 1) {
        await activate(db, current, tokens, shops[0], session.userId);
        await db.query('UPDATE outreach_oauth_states SET finished_at=now() WHERE state_hash=$1', [s.state_hash]);
      } else {
        await db.query('UPDATE outreach_oauth_states SET pending_ciphertext=$1,pending_key_version=$2 WHERE state_hash=$3', [sealCredential({
          tokens,
          shops
        }, values, version, pendingContext(s)), version, s.state_hash]);
      }
    });
    return {
      workspaceId: s.workspace_id,
      channelId: s.channel_id,
      selectionRequired: shops.length > 1
    };
  } catch {
    await markConnectionAttention(s.workspace_id, s.channel_id, 'AUTHORIZATION_FAILED', session.userId, {
      stateHash: s.state_hash
    });
    throw new AppError(409, 'Authorization could not be completed. Reconnect or contact support.');
  }
}
export async function authorizedChoices(session: Session, w: string, id: string) {
  await requireActiveWorkspace(session, w, 'outreach:channel_manage');
  await realChannel({
    query
  }, w, id);
  const s = (await query<Authorization>('SELECT * FROM outreach_oauth_states WHERE workspace_id=$1 AND channel_id=$2 AND actor_id=$3 AND session_id=$4 AND pending_ciphertext IS NOT NULL AND finished_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1', [w, id, session.userId, session.id])).rows[0];
  if (!s) return [];
  try {
    const pending = openCredential<{
      shops: AuthorizedShop[];
    }>(s.pending_ciphertext!, keyring().values, s.pending_key_version!, pendingContext(s));
    return pending.shops.map((shop, index) => ({
      choice: canonicalHash({
        state: s.state_hash,
        index
      }),
      label: shop.name.slice(0, 120),
      region: shop.region
    }));
  } catch {
    throw new AppError(409, 'Authorization choices expired. Reconnect this account.');
  }
}
export async function chooseAuthorizedShop(session: Session, w: string, id: string, choice: string) {
  await requireActiveWorkspace(session, w, 'outreach:channel_manage');
  return transaction(async db => {
    await requireActiveWorkspace(session, w, 'outreach:channel_manage', db);
    const c = await realChannel(db, w, id, true),
      s = (await db.query<Authorization>('SELECT * FROM outreach_oauth_states WHERE workspace_id=$1 AND channel_id=$2 AND actor_id=$3 AND session_id=$4 AND pending_ciphertext IS NOT NULL AND finished_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [w, id, session.userId, session.id])).rows[0];
    if (!s || c.status !== 'PENDING' || c.authorization_state_hash !== s.state_hash) throw new AppError(409, 'Authorization selection is unavailable.');
    const p = openCredential<{
        shops: AuthorizedShop[];
        tokens: Omit<SellerCredential, 'shopId' | 'shopCipher' | 'shopName'>;
      }>(s.pending_ciphertext!, keyring().values, s.pending_key_version!, pendingContext(s)),
      shop = p.shops.find((_, index) => canonicalHash({
        state: s.state_hash,
        index
      }) === choice);
    if (!shop) throw new AppError(404, 'Authorized account choice not found.');
    await activate(db, c, p.tokens, shop, session.userId);
    await db.query('UPDATE outreach_oauth_states SET finished_at=now(),pending_ciphertext=NULL,pending_key_version=NULL WHERE state_hash=$1', [s.state_hash]);
    return {
      connected: true
    };
  });
}
export async function markConnectionAttention(w: string, id: string, code: string, actorId?: string, expected?: {
  stateHash?: string;
  version?: number;
  lease?: string;
}) {
  await transaction(async db => {
    const c = await realChannel(db, w, id, true);
    if (['DISCONNECTED', 'REVOKED'].includes(c.status) || expected?.stateHash && c.authorization_state_hash !== expected.stateHash || expected?.version !== undefined && c.credential_version !== expected.version || expected?.lease && c.refresh_lease !== expected.lease) return;
    await db.query("UPDATE outreach_channels SET status='NEEDS_REAUTH',outbound_capable=false,safe_connection_code=$1,refresh_lease=NULL,refresh_lease_expires_at=NULL,updated_at=now() WHERE id=$2", [/^[A-Z_]{1,64}$/.test(code) ? code : 'CONNECTION_UNAVAILABLE', id]);
    await audit(db, {
      workspaceId: w,
      actorUserId: actorId,
      type: 'OUTREACH_CHANNEL_NEEDS_REAUTH',
      targetType: 'outreach_channel',
      targetId: id,
      metadata: {
        code: /^[A-Z_]{1,64}$/.test(code) ? code : 'CONNECTION_UNAVAILABLE'
      }
    });
  });
}
export async function verifyConnection(session: Session, w: string, id: string) {
  await requireActiveWorkspace(session, w, 'outreach:channel_manage');
  const c = await realChannel({
    query
  }, w, id);
  try {
    const credential = await activeCredential(c),
      provider = await providerFor(c);
    await provider.verify(credential);
    await transaction(async db => {
      await requireActiveWorkspace(session, w, 'outreach:channel_manage', db);
      const current = await realChannel(db, w, id, true);
      if (current.credential_version !== c.credential_version || current.status !== 'CONNECTED') throw new AppError(409, 'Connection changed.');
      await db.query("UPDATE outreach_channels SET verified_at=now(),safe_connection_code=NULL,updated_at=now() WHERE id=$1", [id]);
      await audit(db, {
        workspaceId: w,
        actorUserId: session.userId,
        type: 'OUTREACH_CHANNEL_VERIFIED',
        targetType: 'outreach_channel',
        targetId: id,
        metadata: {
          provider: 'TIKTOK_SHOP'
        }
      });
    });
    return {
      verified: true
    };
  } catch (e) {
    if (e instanceof OutreachProviderError && e.category === 'RATE_LIMIT') {
      await blockProvider(c, e.retryAfterMs || 60000);
      throw new AppError(429, 'Provider rate limit reached. Try again later.');
    }
    await markConnectionAttention(w, id, 'VERIFICATION_REQUIRED', session.userId, {
      version: c.credential_version
    });
    throw new AppError(409, 'Account verification needs attention. Reconnect this account.');
  }
}
export async function refreshConnection(session: Session, w: string, id: string) {
  await requireActiveWorkspace(session, w, 'outreach:channel_manage');
  const initial = await realChannel({
      query
    }, w, id),
    credential = await activeCredential(initial, true),
    lease = randomUUID();
  if (!initial.refresh_expires_at || initial.refresh_expires_at.getTime() <= Date.now()) throw new AppError(409, 'Reconnect this account. Refresh authorization expired.');
  await transaction(async db => {
    await requireActiveWorkspace(session, w, 'outreach:channel_manage', db);
    const c = await realChannel(db, w, id, true);
    if (c.status !== 'CONNECTED' || c.credential_version !== initial.credential_version || c.refresh_lease) throw new AppError(409, 'Account refresh is already active or the connection changed.');
    if ((await db.query("SELECT 1 FROM outreach_deliveries WHERE channel_id=$1 AND state IN('DISPATCHING','DELIVERY_UNKNOWN') LIMIT 1", [id])).rowCount) throw new AppError(409, 'Resolve active or uncertain deliveries before refreshing.');
    await db.query("UPDATE outreach_channels SET refresh_lease=$1,refresh_lease_expires_at=now()+interval '60 seconds',outbound_capable=false WHERE id=$2", [lease, id]);
  });
  try {
    const provider = await providerFor(initial),
      tokens = await provider.tokens(credential.refreshToken, true),
      shops = await provider.shops(tokens.accessToken),
      shop = shops.find(s => s.id === initial.provider_identity);
    if (!shop) throw new OutreachProviderError('AUTH');
    await transaction(async db => {
      await requireActiveWorkspace(session, w, 'outreach:channel_manage', db);
      const c = await realChannel(db, w, id, true);
      if (c.refresh_lease !== lease || c.credential_version !== initial.credential_version || !c.refresh_lease_expires_at || c.refresh_lease_expires_at.getTime() <= Date.now() || c.status !== 'CONNECTED') throw new AppError(409, 'The account refresh lease changed. Reconnect this account.');
      await activate(db, c, tokens, shop, session.userId);
    });
    return {
      refreshed: true
    };
  } catch {
    await markConnectionAttention(w, id, 'REFRESH_REAUTH_REQUIRED', session.userId, {
      version: initial.credential_version,
      lease
    });
    throw new AppError(409, 'Refresh outcome needs attention. Reconnect; the old refresh token will not be retried automatically.');
  }
}
export async function disconnectRealChannel(session: Session, w: string, id: string, revoke = false) {
  await requireActiveWorkspace(session, w, 'outreach:channel_manage');
  return transaction(async db => {
    await requireActiveWorkspace(session, w, 'outreach:channel_manage', db);
    await realChannel(db, w, id, true);
    await db.query("UPDATE outreach_channels SET status=$1,outbound_capable=false,refresh_lease=NULL,refresh_lease_expires_at=NULL,safe_connection_code=NULL,updated_at=now() WHERE id=$2", [revoke ? 'REVOKED' : 'DISCONNECTED', id]);
    await db.query("UPDATE outreach_credential_versions SET status='RETIRED',retired_at=now() WHERE channel_id=$1 AND status='ACTIVE'", [id]);
    await db.query('UPDATE outreach_oauth_states SET finished_at=coalesce(finished_at,now()),pending_ciphertext=NULL,pending_key_version=NULL WHERE channel_id=$1', [id]);
    await audit(db, {
      workspaceId: w,
      actorUserId: session.userId,
      type: 'OUTREACH_CHANNEL_DISCONNECTED',
      targetType: 'outreach_channel',
      targetId: id,
      metadata: {
        locallyRevoked: revoke
      }
    });
    return {
      disconnected: true,
      providerSideRevocationRequired: true
    };
  });
}
export async function blockProvider(c: RealChannel, milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 1000) milliseconds = 60000;
  await query("UPDATE outreach_channels SET provider_blocked_until=greatest(coalesce(provider_blocked_until,now()),now()+$1*interval '1 millisecond'),safe_connection_code='PROVIDER_RATE_LIMIT' WHERE id=$2", [milliseconds, c.id]);
}
export async function acquireProviderPermit(c: RealChannel) {
  const current = await realChannel({
    query
  }, c.workspace_id, c.id);
  const scope = canonicalHash({
    provider: 'TIKTOK_SHOP',
    app: providerFixtureEnabled() ? 'fixture_app' : process.env.OUTREACH_TIKTOK_APP_KEY
  });
  return transaction(async db => {
    await db.query('INSERT INTO outreach_provider_pacing(scope_hash) VALUES($1) ON CONFLICT DO NOTHING', [scope]);
    const p = (await db.query<{
      next_at: Date;
    }>('SELECT next_at FROM outreach_provider_pacing WHERE scope_hash=$1 FOR UPDATE', [scope])).rows[0];
    if (p.next_at.getTime() > Date.now()) throw new OutreachProviderError('RATE_LIMIT', p.next_at.getTime() - Date.now());
    if (current.provider_blocked_until && current.provider_blocked_until.getTime() > Date.now()) throw new OutreachProviderError('RATE_LIMIT', current.provider_blocked_until.getTime() - Date.now());
    await db.query("UPDATE outreach_provider_pacing SET next_at=now()+interval '1 second',updated_at=now() WHERE scope_hash=$1", [scope]);
  });
}
export async function requireOperator(session: Session, w: string, db?: DbClient) {
  await requireActiveWorkspace(session, w, 'outreach:manage', db);
  if (!allowlistedOperator({
    id: session.userId,
    email: session.email
  })) throw new AppError(403, 'Controlled provider certification requires an authorized operator.');
}
export async function waitForProviderPermit(c: RealChannel) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await acquireProviderPermit(c);
      return;
    } catch (e) {
      if (!(e instanceof OutreachProviderError) || e.category !== 'RATE_LIMIT' || (e.retryAfterMs || 0) > 1100 || attempt === 2) throw e;
      await wait(Math.max(e.retryAfterMs || 1000, 10) + 10);
    }
  }
}
export async function recoverConnectionHealth() {
  const rows = (await query<{
    workspace_id: string;
    id: string;
    credential_version: number;
    refresh_lease: string | null;
  }>("SELECT workspace_id,id,credential_version,refresh_lease FROM outreach_channels WHERE provider='TIKTOK_SHOP' AND status='CONNECTED' AND ((refresh_lease IS NOT NULL AND refresh_lease_expires_at<=now()) OR (refresh_lease IS NULL AND access_expires_at<=now())) LIMIT 50")).rows;
  for (const c of rows) await markConnectionAttention(c.workspace_id, c.id, c.refresh_lease ? 'REFRESH_REAUTH_REQUIRED' : 'AUTH_EXPIRED', undefined, {
    version: c.credential_version,
    ...(c.refresh_lease ? {
      lease: c.refresh_lease
    } : {})
  });
  return rows.length;
}
