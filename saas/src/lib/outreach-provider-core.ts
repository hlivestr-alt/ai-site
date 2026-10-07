import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
export const MESSAGE_SCOPE = 'seller.affiliate_messages.write';
export const DIRECTORY_SCOPE = 'seller.creator_marketplace.read';
export type ProviderCategory = 'AUTH' | 'PERMISSION' | 'RATE_LIMIT' | 'RESTRICTED' | 'PRE_SEND_TEMPORARY' | 'FAILED' | 'UNKNOWN';
export class OutreachProviderError extends Error {
  constructor(readonly category: ProviderCategory, readonly retryAfterMs?: number) {
    super(`Outreach provider ${category.toLowerCase().replaceAll('_', ' ')}`);
  }
}
export type SellerCredential = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  scopes: string[];
  sellerId: string;
  shopId: string;
  shopCipher: string;
  shopName: string;
};
export type AuthorizedShop = {
  id: string;
  name: string;
  cipher: string;
  region: string;
};
export type ProviderResult = {
  state: 'SENT' | 'RESTRICTED' | 'FAILED' | 'RETRYABLE' | 'DELIVERY_UNKNOWN';
  code: string;
  messageId?: string;
  requestId?: string;
  retryAfterMs?: number;
};
export type Transport = (url: URL, init: RequestInit) => Promise<Response>;
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' ? v : '';
function identity(v: unknown) {
  const s = typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? String(v) : text(v);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(s) || s === '0' || s === 'unknown') throw new OutreachProviderError('UNKNOWN');
  return s;
}
export function retryAfter(value: string | null, now = Date.now()) {
  if (!value?.trim()) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : null;
  const milliseconds = seconds === null ? Date.parse(value) - now : seconds * 1000;
  return Number.isFinite(milliseconds) && milliseconds >= 0 ? Math.ceil(milliseconds) : undefined;
}
export function providerSignature(path: string, query: Record<string, string | number>, body: string, secret: string) {
  const parameters = Object.entries(query).filter(([k]) => !['sign', 'access_token'].includes(k)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => k + v).join('');
  return createHmac('sha256', secret).update(secret + path + parameters + body + secret).digest('hex');
}
export function credentialKey(keyring: Record<string, string>, version: number) {
  const encoded = keyring[String(version)];
  if (!encoded || !/^[a-f0-9]{64}$/i.test(encoded)) throw new Error('Outreach credential key version unavailable');
  return Buffer.from(encoded, 'hex');
}
export function sealCredential(value: unknown, keyring: Record<string, string>, version: number, context: string) {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', credentialKey(keyring, version), nonce);
  cipher.setAAD(Buffer.from(context));
  const payload = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), payload]);
}
export function openCredential<T>(payload: Buffer, keyring: Record<string, string>, version: number, context: string): T {
  try {
    if (payload.length < 32) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', credentialKey(keyring, version), payload.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(payload.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8')) as T;
  } catch {
    throw new Error('Outreach credential cannot be authenticated');
  }
}
/** Fixed provider origins; no browser-configurable URL, native fallback or automatic HTTP retry. */
export class TikTokShopProvider {
  constructor(private readonly options: {
    appKey: string;
    appSecret: string;
    transport?: Transport;
    now?: () => number;
    beforeRequest?: () => Promise<void>;
    beforeMessage?: () => Promise<void>;
  }) {}
  private async fetch(url: URL, init: RequestInit) {
    await this.options.beforeRequest?.();
    if (init.method === 'POST' && url.pathname.endsWith('/messages')) await this.options.beforeMessage?.();
    try {
      return await (this.options.transport || fetch)(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(20000)
      });
    } catch {
      throw new OutreachProviderError('UNKNOWN');
    }
  }
  private async payload(response: Response) {
    try {
      if (Number(response.headers.get('content-length') || 0) > 1048576) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          if (length > 1048576) {
            await reader.cancel();
            throw new Error();
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
      return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      throw new OutreachProviderError('UNKNOWN');
    }
  }
  async tokens(codeOrRefresh: string, refresh = false) {
    if (!codeOrRefresh || codeOrRefresh.length > 4096) throw new OutreachProviderError('AUTH');
    const u = new URL(refresh ? '/api/v2/token/refresh' : '/api/v2/token/get', 'https://auth.tiktok-shops.com');
    for (const [k, v] of Object.entries({
      app_key: this.options.appKey,
      app_secret: this.options.appSecret,
      grant_type: refresh ? 'refresh_token' : 'authorized_code',
      [refresh ? 'refresh_token' : 'auth_code']: codeOrRefresh
    })) u.searchParams.set(k, v);
    const response = await this.fetch(u, {
        method: 'GET',
        headers: {
          accept: 'application/json'
        }
      }),
      p = await this.payload(response);
    if (!response.ok || p.code !== 0) throw new OutreachProviderError('AUTH');
    const d = object(p.data),
      now = this.options.now?.() || Date.now(),
      access = Number(d.access_token_expire_in) * 1000,
      expiry = Number(d.refresh_token_expire_in) * 1000;
    const scopes = Array.isArray(d.granted_scopes ?? d.granted_permissions) ? d.granted_scopes ?? d.granted_permissions : typeof (d.granted_scopes ?? d.granted_permissions) === 'string' ? String(d.granted_scopes ?? d.granted_permissions).split(',') : [];
    if (!text(d.access_token) || !text(d.refresh_token) || Number(d.user_type) !== 0 || !Number.isFinite(access) || access <= now || !Number.isFinite(expiry) || expiry <= access) throw new OutreachProviderError('UNKNOWN');
    return {
      accessToken: text(d.access_token),
      refreshToken: text(d.refresh_token),
      accessExpiresAt: new Date(access).toISOString(),
      refreshExpiresAt: new Date(expiry).toISOString(),
      scopes: (scopes as unknown[]).filter((s): s is string => typeof s === 'string' && /^[a-z_.]{1,100}$/.test(s)).slice(0, 100),
      sellerId: identity(d.open_id)
    };
  }
  private async request(method: 'GET' | 'POST', path: string, credential: Pick<SellerCredential, 'accessToken' | 'shopCipher'>, body?: Record<string, unknown>) {
    const encoded = body === undefined ? '' : JSON.stringify(body),
      query: Record<string, string | number> = {
        app_key: this.options.appKey,
        timestamp: Math.floor((this.options.now?.() || Date.now()) / 1000),
        ...(credential.shopCipher ? {
          shop_cipher: credential.shopCipher
        } : {})
      },
      u = new URL(path, 'https://open-api.tiktokglobalshop.com');
    for (const [k, v] of Object.entries({
      ...query,
      sign: providerSignature(path, query, encoded, this.options.appSecret)
    })) u.searchParams.set(k, String(v));
    const response = await this.fetch(u, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-tts-access-token': credential.accessToken
      },
      ...(body === undefined ? {} : {
        body: encoded
      })
    });
    return {
      response,
      payload: await this.payload(response)
    };
  }
  private rejected(response: Response, p: Record<string, unknown>, sending = false): never {
    const code = Number(p.code);
    if (sending && (response.status >= 500 || !Number.isSafeInteger(code))) throw new OutreachProviderError('UNKNOWN');
    if (response.status === 401 || [105001, 105002].includes(code)) throw new OutreachProviderError('AUTH');
    if (response.status === 403 || code === 105005) throw new OutreachProviderError('PERMISSION');
    if ([16030001, 16030003, 16030007, 16030009, 16032001, 45101021, 16030100, 16030101].includes(code)) throw new OutreachProviderError('RESTRICTED');
    if (response.status === 429 || [16030002, 45101004, 36009002].includes(code)) throw new OutreachProviderError('RATE_LIMIT', retryAfter(response.headers.get('retry-after'), this.options.now?.()));
    if (!sending && (response.status >= 500 || [36009003, 36009007].includes(code))) throw new OutreachProviderError('PRE_SEND_TEMPORARY');
    throw new OutreachProviderError(Number.isSafeInteger(code) && code !== 0 ? 'FAILED' : 'UNKNOWN');
  }
  async shops(accessToken: string) {
    const {
      response,
      payload
    } = await this.request('GET', '/authorization/202309/shops', {
      accessToken,
      shopCipher: ''
    });
    if (!response.ok || payload.code !== 0) this.rejected(response, payload);
    const shops = object(payload.data).shops;
    if (!Array.isArray(shops) || shops.length < 1 || shops.length > 100) throw new OutreachProviderError('PERMISSION');
    return shops.map(v => {
      const s = object(v),
        id = identity(s.id),
        name = text(s.name),
        region = text(s.region),
        cipher = text(s.cipher);
      if (!name || name.length > 120 || /[\x00-\x1f]/.test(name) || !cipher || cipher.length > 4096 || !/^[A-Z]{2}$/.test(region) || [accessToken, this.options.appSecret, cipher].some(secret => secret && [id, name, region].some(field => field.includes(secret)))) throw new OutreachProviderError('UNKNOWN');
      return {
        id,
        name,
        cipher,
        region
      } as AuthorizedShop;
    });
  }
  async verify(credential: SellerCredential) {
    if (new Date(credential.accessExpiresAt).getTime() <= Date.now()) throw new OutreachProviderError('AUTH');
    const shops = await this.shops(credential.accessToken),
      shop = shops.find(s => s.id === credential.shopId);
    if (!shop) throw new OutreachProviderError('AUTH');
    if (!credential.scopes.includes(MESSAGE_SCOPE)) throw new OutreachProviderError('PERMISSION');
    return shop;
  }
  async creator(credential: SellerCredential, openId: string) {
    if (!credential.scopes.includes(DIRECTORY_SCOPE)) throw new OutreachProviderError('PERMISSION');
    identity(openId);
    const {
      response,
      payload
    } = await this.request('GET', `/affiliate_seller/202508/marketplace_creators/${encodeURIComponent(openId)}`, credential);
    if (!response.ok || payload.code !== 0) this.rejected(response, payload);
    return object(payload.data);
  }
  async conversation(credential: SellerCredential, openId: string) {
    identity(openId);
    const {
      response,
      payload
    } = await this.request('POST', '/affiliate_seller/202508/conversations', credential, {
      creator_open_id: openId,
      only_need_conversation_id: true
    });
    if (!response.ok || payload.code !== 0) this.rejected(response, payload);
    return identity(object(payload.data).conversation_id);
  }
  async message(credential: SellerCredential, conversationId: string, content: string): Promise<ProviderResult> {
    try {
      identity(conversationId);
      const {
        response,
        payload
      } = await this.request('POST', `/affiliate_seller/202412/conversations/${encodeURIComponent(conversationId)}/messages`, credential, {
        msg_type: 'TEXT',
        content: JSON.stringify({
          content
        })
      });
      if (!response.ok || payload.code !== 0) this.rejected(response, payload, true);
      const messageId = identity(object(payload.data).message_id);
      if ([credential.accessToken, credential.refreshToken, credential.shopCipher, this.options.appSecret].some(s => s && messageId.includes(s))) throw new OutreachProviderError('UNKNOWN');
      let requestId: string | undefined;
      try {
        requestId = identity(payload.request_id ?? response.headers.get('x-tts-request-id'));
        if ([credential.accessToken, credential.refreshToken, credential.shopCipher, this.options.appSecret].some(s => s && requestId!.includes(s))) requestId = undefined;
      } catch {}
      return {
        state: 'SENT',
        code: 'PROVIDER_CONFIRMED_SENT',
        messageId,
        requestId
      };
    } catch (e) {
      if (!(e instanceof OutreachProviderError)) return {
        state: 'DELIVERY_UNKNOWN',
        code: 'PROVIDER_RESPONSE_UNKNOWN'
      };
      if (e.category === 'AUTH' || e.category === 'PERMISSION') throw e;
      if (e.category === 'UNKNOWN') return {
        state: 'DELIVERY_UNKNOWN',
        code: 'PROVIDER_RESPONSE_UNKNOWN'
      };
      return {
        state: e.category === 'RESTRICTED' ? 'RESTRICTED' : 'FAILED',
        code: e.category === 'RATE_LIMIT' ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_REJECTED',
        retryAfterMs: e.retryAfterMs
      };
    }
  }
}
