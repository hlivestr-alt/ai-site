# Phase F — Provider Authentication and Creator Data Audit

Read-only audit on 2026-10-07, before Phase F application edits. References are the configured native repository `C:\Data\TikTok Outreach` and the Phase E commits `e87651b10a8f4162a2fe45c6a6328293b3fa7890` / `c28641c84a9e3a16200d1729906d6038135b6c20`. No native/provider mutation, authorization, refresh, discovery or message request was made during this audit.

## Preflight

Git was clean; both Phase E commits are present. Fingerprints preserve 523 prior documentation/evidence files, 108 Outreach-related files, 264 native source/configuration files, private deployment configuration and SaaS schema/history. Current live wallet: **3,880 available / 1,200 reserved**. All 15 Outreach tables are empty. No Phase E test process is running. Existing application code, HTTP admission and database constraints permit only isolated TEST sends; no customer real-send capability exists.

The two legitimate Clipper jobs and their reservation/history are outside Phase F fixtures and must not be settled, released, deleted or restored to the earlier wallet snapshot.

## Provider Authentication Facts

Reviewed native `packages/tiktok-adapter/src/auth.ts`, `signing.ts`, `token-crypto.ts`, `real-read-only.ts`, `real-outbound.ts`; API `integrations/tiktok.service.ts`, controller and governor; provider integration documentation and Prisma schema. These implement **TikTok Shop seller authorization**, not browser cookies, automated password login or session scraping.

Authorization uses a Partner Center service identifier and random state; server-side token exchange calls `GET /api/v2/token/get` with an authorization code. Refresh calls `GET /api/v2/token/refresh`. The client expects access/refresh tokens, absolute epoch-second expiry fields, seller user type `0`, seller Open ID and returned granted scopes. Tokens never establish SaaS Workspace ownership by themselves.

Signed API requests use HMAC-SHA256 over canonical path, sorted query and exact JSON body, with `x-tts-access-token`. Authorized-shop verification uses `GET /authorization/202309/shops`. A shop cipher is private request material. Shop ID, seller ID, Creator Open ID, messaging participant ID and conversation ID are distinct namespaces.

The SaaS mail encryption primitive was also inspected before provider implementation. It supplies AES-256-GCM but its single mail key and unversioned envelope do not bind provider credentials to Workspace/channel/account/generation. Phase F uses the established Node authenticated-encryption primitive with separate versioned keys and associated ownership data. Mail/native keys and private deployment configuration are unchanged.

Messaging requires the returned `seller.affiliate_messages.write` grant. Marketplace/performance discovery requires `seller.creator_marketplace.read`. Native code sends through `POST /affiliate_seller/202508/conversations`, then `POST /affiliate_seller/202412/conversations/{conversationId}/messages`; a successful response without a positive message ID is uncertain. Native idempotency arguments are not transmitted as an official mutation idempotency field. No safe replay guarantee may be inferred.

## Native → SaaS Provider Matrix

| Provider capability | Native behavior | Safe SaaS equivalent | Phase F action |
| --- | --- | --- | --- |
| Authorization | Seller authorization URL with service ID and random state | State bound to Workspace, channel, actor and session; expire and consume once | ADAPT |
| Token exchange | Server GET with app secret/code query | Fixed authorized HTTPS origin, bounded request/body, no URL/raw-error logging | ADAPT; dedicated SaaS app only |
| Authorized shops | Fetches exact shop identities/ciphers | Verify account; explicit owned selection; encrypt cipher | REIMPLEMENT TENANT-SAFE |
| Native shop selection | Global operator-selected shop | Never imported or used as fallback | NOT CUSTOMER-SAFE |
| Permissions | Returned scope checks | Separate identity, discovery and outbound capabilities | ADAPT; fail closed |
| Encryption | AES-256-GCM, random 12-byte IV, versioned envelope | Dedicated SaaS keyring, authenticated ownership context, immutable credential versions | ADAPT primitive; do not copy keys |
| Refresh | Durable lease/token-generation CAS; ambiguous refresh requires reauthorization | Same conservative lifecycle on owned channel | ADAPT |
| Account identity | Native external-shop identity | Durable unique provider account across Workspaces, retained after disconnect | REIMPLEMENT TENANT-SAFE |
| Send | Conversation creation then text-message POST | Same Phase E admission/outbox/attempt/lease/billing; provider execution differs | ADAPT behind disabled real gate |
| Positive proof | Successful response plus message ID | Private immutable proof associated with current delivery/attempt | ADAPT |
| Ambiguous submission | DELIVERY_UNKNOWN | Hold exclusion/reservation; no blind resend or fake negative evidence | PRESERVE |
| Error mapping | Auth, permission, quota, restriction, temporary codes | Safe fixed categories; ambiguous send 5xx/malformed body remains unknown | STRENGTHEN |
| Pacing | Durable App × Shop permit; at least 1 second, Retry-After/backoff | Durable provider/channel pacing; canary limits one actual send attempt | ADAPT conservatively |
| Limits | Dynamic quota; no verified fixed QPS | Conservative defaults and explicit provider response enforcement | Exact commercial/provider quota contract NOT CERTIFIED |
| History | Read conversation/message pages; exact identity evidence | No speculative body/time matching to infer failed sends | DEFER automatic real unknown reconciliation |
| Callback | One-use state; native callback has no SaaS membership guard | Actor/session/Workspace binding, no browser-supplied ownership | REIMPLEMENT TENANT-SAFE |
| Delivery webhook | No webhook contract in examined integration | Do not invent webhook or signature contract | N/A; no delivery webhook endpoint |
| PKCE | Not present in examined seller service-ID flow | Do not claim provider support; server secret + state binding | Contract review required |
| Disconnect/revoke | Local token lifecycle; no inspected official revoke endpoint | Local immediate dispatch stop, retire credentials, preserve history; provider-side revoke operator action | ADAPT; no invented revoke API |
| Creator directory | Native shop snapshots / crawler, over 397k historical records | Approved server directory only; no native DB dependency | Native dataset NOT AUTHORIZED |
| Controlled recipient | Requires exact provider-compatible Creator Open ID | One operator-controlled recipient with exact provider verification and scoped authorization | Prepare controlled canary boundary |
| Customer creator import | No proven open upload product/consent contract | No public spam-list upload | DEFER |
| Certification | Native operational success does not certify SaaS | Separate connection/certification and bulk-release gates | REIMPLEMENT |

## Official Contract Review

Reference links: [seller authorization](https://partner.tiktokshop.com/docv2/page/authorization-overview-202407), [authorized shops](https://partner.tiktokshop.com/docv2/page/call-get-authorized-shops), [request signing](https://partner.tiktokshop.com/docv2/page/sign-your-api-request), [Create Conversation](https://partner.tiktokshop.com/docv2/page/create-conversation-with-creator-202508), [Send IM Message](https://partner.tiktokshop.com/docv2/page/send-im-message-202412), [rate limits](https://partner.tiktokshop.com/docv2/page/rate-limits), [creator search](https://partner.tiktokshop.com/docv2/page/seller-search-creator-on-marketplace-202508).

The current web reader receives only the documentation site's JavaScript shell; managed browser access did not provide the document body. Therefore native-observed contracts above are factual code observations, **not a fresh official-contract certification**. Real enablement must require review of the dedicated app's current Partner Center authorization, API grants, callback, identity/expiry fields, message proof and limits. The operator confirmed that a dedicated SaaS developer app is **not available yet** and requested that the integration be prepared. No native app credentials will be substituted.

## Creator Source Authorization

| Source | Ownership / refresh | Approved visibility | Current result |
| --- | --- | --- | --- |
| Phase E synthetic directory | Owned isolated QA fixtures; no external refresh | Safe targeting metrics and labels, explicitly TEST | Available only in isolation |
| Native crawler / historical dataset | Internal shop/crawler history; no SaaS license/consent established | None to customer Workspaces | NOT AUTHORIZED / NOT CERTIFIED |
| Dedicated provider-authorized discovery | Future customer-owned seller grant; exact Marketplace/performance identity | Only reviewed fields under scoped authorization | NOT CERTIFIED; no live reads during this phase |
| One controlled recipient | Operator-confirmed authorization plus exact provider identity evidence on own channel | Safe name/metrics and frozen message for that Workspace | Certification preparation only; no open list upload |

No hidden contact method, raw crawler payload, native database URL or provider cipher belongs in customer responses. Shared Billing Account ownership is not data-source or sender authorization.

## Legacy Credential Incident

The affected credential was identified privately with confidence from the old AI Site Outreach connection and matching native private configuration. A loopback read-only database check confirms it is **still active**. Affected running services: native API, discovery worker, outbound-live worker, history worker and native PostgreSQL; the legacy AI Site also has the matching connection configured.

Exact affected running service names: `tiktokoutreach-api-1`, `tiktokoutreach-discovery-worker-1`, `tiktokoutreach-outbound-live-1`, `tiktokoutreach-history-worker-1` and `tiktokoutreach-postgres-1`.

No value, username/password pair, connection URL or decrypted token is reproduced. No credential was rotated or configuration changed. **Incident unresolved; separately authorized legacy credential rotation remains recommended.**

## Decision

A tenant-safe official-token integration can be prepared without importing native credentials, identities, campaigns or creator records. Real onboarding and sending remain blocked pending the dedicated SaaS app, private key/app configuration and current provider-contract review. Real creator-directory approval remains independent. Real sends stay **0**; a later explicit operator approval may permit only one controlled canary, never automatic bulk activation. Phase 10 is not started.
