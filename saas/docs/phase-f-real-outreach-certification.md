# Phase F — Real Outreach Integration

## Outcome

Application/provider integration: **PASS in isolated acceptance / integration prepared**. Existing native developer-app configuration: **REUSED / LOAD AND STRUCTURAL CHECKS PASS** on 2026-10-08, following explicit operator authorization. Real account onboarding: **BLOCKED** by callback routing preflight and the remaining activation guards. Real provider: **NOT CERTIFIED**. Real canary: **NOT READY / NOT RUN**; explicit operator approval remains required after the missing provider inputs are supplied. No real messages or paid AI/LLM/payment operations have been initiated. Phase 10 has not started.

The implementation prepares official-token onboarding, encrypted Workspace-owned accounts, a controlled recipient directory and an exact one-message approval through the Phase E execution/billing path. Fixture acceptance cannot certify current provider grants, live authorization, external message delivery or creator-data licensing.

Implementation commit: `1e8c07e60aa770f9168179a5d0d96dd3b524f389` — Implement real Outreach provider integration. Documentation/readiness is a separate local commit; neither commit is pushed.

## Provider Authentication Audit

See [Phase F provider audit](phase-f-provider-audit.md) for the native-code capability matrix, source references, preflight and unresolved contract review. Native uses official TikTok Shop seller tokens, authorized shops, HMAC request signing and access/refresh expiry. It does not use scraped browser cookies or automated password login. Existing native sender selection is not SaaS tenant authorization.

## Authorization Method

Connect account uses the configured developer app and must create a fresh seller authorization for the selected SaaS Workspace. The existing native app's app key, app secret and service ID are now privately reused; a second developer app is not required by this implementation. The SaaS callback is `/api/outreach/tiktok/callback` on the existing HTTPS test host. Authorization code exchange and shop verification run only on the server. Native seller credentials, internal selected-shop state and native callback ownership are not reused.

The original Phase F implementation derived its contract from inspected native code, not a fresh provider certification. The existing app's Partner Center record, customer-authorization eligibility and registered callbacks have not been read through a signed-in management session. Before enabling onboarding, review its current seller grants, callback routing, token fields, exact Creator Open ID namespace, message IDs and quotas. `OUTREACH_TIKTOK_CONTRACT_REVIEWED=1` records that review; it remains unset. The required internal-account exclusion list also remains unset, so `providerConfiguration().configured` is false even though the app values and encryption key load successfully.

### Existing App Configuration Follow-up — 2026-10-08

Only three app-level values were copied directly from native private configuration into ignored SaaS private configuration. A new versioned SaaS encryption key was generated independently of native and mail encryption keys. Fresh loading through Next.js's actual `@next/env` loader matches all three native app values. In-memory intercepted requests verify the fixed token-exchange endpoint and parameters and the API HMAC signature; no request was sent to TikTok and no authorization code or seller token was obtained. Authenticated encryption passes a round trip and rejects another Workspace's context. This is structural readiness, not a live provider grant certification. See [shared-app configuration evidence](phase-f-evidence/shared-app-configuration.json).

Callback routing preflight is **BLOCKED**. Native private configuration points to an HTTP loopback callback at `/api/v1/integrations/tiktok/callback`; SaaS requires its own HTTPS callback at `/api/outreach/tiktok/callback`. Both implementations build authorization URLs with service ID and state, without selecting a callback using `redirect_uri`. The native callback looks up state only in native `tikTokAuthorizationState`; a SaaS state would fail with “Authorization state does not match” before token exchange. No shared callback router exists. This is an observed configuration/code limitation; the actual Partner Center registration was not inspected, so no live callback rejection is claimed. Work stopped before seller authorization. No native or Partner Center callback/app setting was changed.

Native private configuration is unchanged. SaaS and native use the same developer app with separate seller credential stores and independent encryption keys. Live SaaS channel, OAuth state, credential and delivery tables remain empty. No native seller access/refresh token, shop cipher, selected shop, authorization record, sender/campaign identity, cookie or browser session was copied. `OUTREACH_REAL_SEND_ENABLED=0` and `OUTREACH_PROVIDER_FIXTURE=0`; real messages remain **0**. Only the owned SaaS process was reloaded to consume private configuration; native services were left running. No application source change was required. Original Phase A–F acceptance evidence is preserved.

## Workspace-Owned Channel Model

Each channel belongs to exactly one Workspace. Provider identity, authorization realm, scopes, timestamps, expiry, credential generation and certification are durable server metadata. Browser DTOs omit provider IDs, credential references, encrypted envelopes, tokens and raw receipts. An isolated fake-real channel is explicitly shown as a TEST provider fixture.

## Provider Account Uniqueness

A partial unique index binds `(provider, provider_identity)` to one channel. Disconnect retains that identity and all history. Identity reassignment and credential generation regression are rejected. Sharing an Owner or Billing Account never shares a channel. A private internal-account fingerprint exclusion list is mandatory for real configuration and is checked at activation and dispatch eligibility. No native-account identity is backfilled into SaaS.

## Credential Encryption

Credentials use AES-256-GCM with independent random 12-byte nonces, 16-byte tags and a versioned private keyring. Associated data binds Workspace, channel, provider account and credential generation; temporary authorization selections also bind the actor, session and state hash. The existing SaaS mail primitive was inspected: it uses authenticated encryption, but its single mail key, absent ownership context and unversioned envelope do not fit provider credential lifecycle. Phase F uses the same established Node crypto primitive with separate keys and versioned ownership binding. Mail/native encryption keys are not reused. Credentials remain immutable encrypted envelopes with separate active/retired metadata. Older configured key versions can decrypt historical envelopes. Original acceptance changed no deployment keys; the authorized app-configuration follow-up subsequently provisioned a new SaaS-only keyring without replacing any existing key.

## Credential Lifecycle

Pending authorization, Connected, Needs reauthorization, Disconnected, Revoked and Error states are supported. Connection verification reads authorized account state and sends no creator message. Refresh leases fence concurrent requests; verified replacements activate atomically and retire the previous generation. An uncertain refresh requires reconnect and never retries an old refresh token automatically. Expired credentials or lost refresh leases disable authorization. Disconnect/revoke stops new dispatch and preserves attribution and billing. Local revocation is implemented; provider-side revocation must be completed in Partner Center because no supported revocation API was established by the audit.

## Real Provider Adapter

The worker chooses a provider from the owned channel. TEST and real adapters share campaigns, immutable recipient/message snapshots, delivery attempts, outbox leases, channel serialization, pause/resume/cancel, exclusions and account-level settlement. There is no independent real campaign/billing pipeline or native-sender fallback. Fixture transport requires the existing strict owned-test database gate and performs no external HTTP requests.

## Provider Response Mapping

| Factual outcome | Application state / action |
| --- | --- |
| Successful response with a valid accepted message ID | SENT; persist private proof before completion |
| Definite recipient restriction | RESTRICTED; no retry; release unsent reservation |
| Structured definite rejection | FAILED; no second canary message attempt |
| Pre-message temporary error / rate response | Bounded RETRYABLE through the existing outbox |
| Definite authorization/permission rejection | Needs reauthorization; no alternate account |
| Message timeout, 5xx, malformed response or missing message ID | DELIVERY_UNKNOWN; never blind retry |

Raw provider errors, headers, bodies and URLs are not returned or logged. Safe categories and correlation hashes support diagnosis.

## Delivery Proof

An accepted provider message ID is the inspected API's factual submission proof. The immutable private proof binds delivery, attempt, Workspace, channel, provider identity and frozen-message hash. It commits independently of worker completion. SQL rejects real SENT without matching proof. Customer pages show ordinary delivery states, not raw receipts. Provider acceptance is distinct from operator-confirmed receipt and certification.

## Delivery Unknown

Ambiguous submissions retain contact exclusion and the required 10-Token reservation. The sole external message allowance is consumed durably immediately before the message request, so a crash cannot replay it. Reconciliation may use matching persisted accepted-message proof to resolve SENT once. Proof absence is never evidence of NOT_SENT. No supported lookup/webhook sufficient to resolve an otherwise ambiguous message was established; those cases remain held and require a separately reviewed support policy. Disconnect does not erase or falsely cancel an uncertain submission.

## Rate Limits / Pacing

App-wide database permits and existing channel serialization impose conservative spacing of at least one second per provider request. Full Retry-After delays, including HTTP dates and a one-hour fixture limit, are respected without the TEST adapter's shorter retry cap. Only safe pre-message failures may retry, within the existing three-attempt bound. The first certification allows one message attempt. Exact app/account/day quotas remain subject to current contract review and observed provider enforcement; this is not bulk capacity certification. SaaS and native database governors are separate, so sharing an app does not prove coordination of its combined provider quota.

## Creator Data Source

The CreatorDirectoryProvider boundary supports synthetic TEST data and exactly one controlled, provider-verified recipient per owned channel. The native historical/crawler dataset is inaccessible to customer discovery. There is no open list upload or browser database access. The controlled adapter exposes a QA label and validated safe numeric metrics; it does not copy raw provider payloads or fabricate GMV/relevance statistics.

## Creator Data Authorization

**REAL CREATOR DIRECTORY: NOT CERTIFIED.** Native data authorization was not established, so no native records were imported. One controlled recipient requires explicit operator authorization, membership, an owned provider grant and an exact returned Creator Open ID. Real directory licensing/consent, broad discovery, refresh and field approval remain deferred. A later controlled recipient may enable canary certification without granting general directory access.

## Channel Health

Account settings distinguish TEST simulation, Connected, Needs reauthorization, Disconnected and Pending activation. Verify connection is a server action without sending. Missing app configuration displays Contact support / Pending activation. Connection and certification are separate; connecting or refreshing does not certify the provider. Real sending and bulk availability are explicit.

## Callback / Webhook Security

A random one-use 10-minute state is stored only as a hash and bound to Workspace, channel, actor and authenticated session. Callback ownership never comes from a browser Workspace parameter. Invalid/expired/replayed states, different sessions and superseded authorizations fail closed. Multiple authorized shops require explicit account selection from encrypted pending state. Redirects omit the authorization query and use no-store/no-referrer. No delivery webhook, provider signature scheme or PKCE support was established in the inspected contract; no speculative endpoint or bypass was implemented.

## Real-Send Gate

`OUTREACH_REAL_SEND_ENABLED` defaults to 0 and is explicitly 0 in the current private configuration; bulk sending is hard disabled. Real dispatch also requires Outreach availability, reviewed developer-app configuration, encryption keys, internal-account exclusions, an active Workspace-owned grant with message scope, healthy token metadata, exact approved canary, creator authorization and the existing wallet/quote rules. An incorrectly enabled fixture flag outside an owned fixture environment fails closed. Browser values cannot turn these gates on.

## Canary Gate

Prepare and Approve are separate private operator operations. Preparation freezes a small benign message/configuration for one controlled recipient, with a 30-minute approval window. Approval binds that exact content; dispatch rechecks active operator Workspace authority, current account authorization, membership, exclusions and the delivery lease. More than one recipient, changed content, approval replay or a second message attempt is rejected. Normal Send Campaign can use only the exact operator-approved configuration on a real channel; its recipient count/content controls are locked. A private CLI uses the same quote/admission APIs.

No real account/Workspace/channel/recipient has been selected and no real approval has been created. Future maximum external sends: **1**. The safe test message and selected controlled identities must be reviewed with the operator before requesting final approval.

## Billing

Phase E internal-beta price remains 10 Tokens per confirmed successful send in both catalogs. A one-recipient canary reserves 10, captures 10 for factual SENT, releases 10 for a definite unsent result, and holds 10 for unknown. The existing ledger/idempotency/settlement code handles every provider. No hidden free-send bypass or final commercial price change is introduced.

## Workspace Isolation

Connection, verification, refresh, reconnect, disconnect, quote, campaign, recipient, delivery and audit resolution remain scoped by membership and Workspace IDs. Foreign direct-ID tests cover both shared and separate billing accounts. Existing editor/viewer restrictions remain. Historical data stays private after disconnect.

## Shared Wallet

Fake-real acceptance proves the owned Brand A campaign charges the shared account once; Brand B sees the shared 990 balance from a 1,000-Token fixture without access to Brand A's sender. A separate account remains at 1,000. Live accounting is preserved at **3,880 available / 1,200 reserved**; the two legitimate operator Clipper jobs are not settled, released or deleted by Phase F.

## Browser / Responsive

**PASS.** Actual installed Chrome 154.0.8037.98 and Edge 154.0.4258.62 cover `/outreach`, `/outreach/new`, campaign detail and account settings at 1440×1000, 768×1024 and 390×844. Six real-channel fixture states across four pages and three viewports produce 72 checks per browser (144 total); the TEST account remains visible and explicitly synthetic. No horizontal overflow, raw credential fields, console/API credential leaks or page crashes were detected. Additional Chrome/Edge tests pass the unapproved-disabled and exact-approved one-click canary flow, including automatic recovery of the locked approved configuration, with one simulated message and a 10-Token capture. Mobile and desktop screenshots were visually inspected. The prior light/dark Outreach and editor browser acceptance also passes.

The updated production build is running on port 3200. Public remote HTTPS smoke passes in Chrome and Edge on the five authentication pages plus a healthy `/api/health`, without remote account mutations or mail. Authenticated provider-state acceptance is isolated; no real account onboarding is claimed. See [browser facts](phase-f-evidence/provider-browser-chrome.json), [Edge facts](phase-f-evidence/provider-browser-msedge.json) and [remote smoke](phase-f-evidence/remote-public.json).

## Secret Audit

**PASS, zero findings in the original Phase F artifacts.** Tests inspect encrypted storage, browser DTOs, console/network responses, logs, production bundles, working tree and staged Git. Evidence records only acceptance facts; Playwright environment dumps, cookies, raw bodies and credential values are excluded. At original acceptance, three private configuration files were ignored and unchanged, and all 523 Phase A-E evidence files matched their original hashes. The later authorized app-only private configuration change is recorded separately above. Full original audit counts and staged-index coverage are recorded in [secret audit](phase-f-evidence/secret-audit.json). This result does not resolve the earlier transcript incident below.

## Legacy Credential Incident Status

**UNRESOLVED / STILL ACTIVE / NOT ROTATED.** The previously exposed legacy database connection was identified privately with confidence. Read-only loopback authentication proves it remains active. Affected running services: `tiktokoutreach-api-1`, `tiktokoutreach-discovery-worker-1`, `tiktokoutreach-outbound-live-1`, `tiktokoutreach-history-worker-1` and `tiktokoutreach-postgres-1`. The old AI Site also has the matching connection configured. No value is repeated. Separately authorized rotation remains recommended. A clean Phase F artifact audit does not resolve the previous transcript incident.

## Native Preservation

**PASS at original Phase F acceptance.** 264 native source/configuration files and all 41 native schema tables matched their baseline hashes. Three private deployment configuration files were unchanged. No native account, credential, campaign or creator row was imported or modified. All 523 prior evidence files were unchanged. Full live row fingerprints across 22 historical tables matched the Phase F preflight. New forward migration `0016_outreach_provider_onboarding.sql` was applied after every isolated suite passed; the transaction checked history before/after and matched the canonical tested schema. No ledger entry or content version was added, no live Outreach fixture was created, and both internal-beta price catalogs remained 10 Tokens per confirmed send. Prior migrations were not edited. See [migration](phase-f-evidence/live-migration.json) and [preservation](phase-f-evidence/preservation.json). The later authorized app-only configuration follow-up changes only SaaS private configuration and these readiness notes; native configuration and prior evidence are preserved.

## Phase A-E Regression

**PASS.** Auth, Workspaces, Products, AI Video, Clipper, variations, Content Library, shared/separate wallets, test payments, private storage, worker recovery, Outreach TEST, pause/resume/cancel, DELIVERY_UNKNOWN and tenant isolation pass isolated regression with fake paid providers. Historical remote SMTP certification is preserved; isolated regression mail uses only the local QA transport, with no new real emails. The F harness copies specs only into ignored storage to redirect new evidence and retain all previous source/evidence. An older video UI test now waits for onboarding to finish before reading its session; the copied focused spec preserves inline Node import paths. These are harness synchronization/import fixes, not unrelated product changes.

## Tests

**Final acceptance: 378 passed executions / 341 distinct cases; zero retries and zero skips.** 37 executions repeat scenario titles through overlapping regression commands. All 16 isolated suites passed and their databases, buckets and gateways were deleted. All A-O scenarios use isolated provider fixtures and no real messages.

| Final command group | Passed executions |
| --- | ---: |
| SaaS unit | 118 |
| Worker unit | 82 |
| Integration | 35 |
| Full browser | 41 |
| Shared wallet | 13 |
| Clipper variations | 8 |
| Variation restart | 5 |
| Editor | 2 |
| Isolation | 3 |
| Focused product/recovery | 6 |
| Worker restart | 7 |
| Phase B customer/auth | 8 |
| Outreach TEST | 13 |
| Outreach restart | 6 |
| Outreach browser | 5 |
| Provider A-O and additional security/lifecycle cases | 22 |
| Provider state browser | 2 |
| Approved canary form browser | 2 |
| **Total** | **378** |

Lint, final TypeScript check and optimized production build also pass. After promoting the staged build, ignored route definitions were regenerated with `next typegen` for their new location; this corrected relative type imports without an application source change. The private canary CLI now recovers the same campaign before requesting a fresh quote, so a lost-reply retry cannot consume a second authorization.

Earlier recorded runs total 66 executions: 50 passed and 16 failed. These include provider runs 7/18 and 15/18, a preliminary 18/18 provider pass, and initial browser/focused runs of 5/6 each. Failures exposed an idle HTTP test-client reset, fixture email reuse, a rate-fixture counter condition, an attempted edit of an immutable lease, the onboarding race and copied inline-import issue. Fixes use unique identities/fresh authenticated read clients, a single simulated rate failure, natural lease expiry and the corrected copied-spec harness. Safe reports are retained. The final 22-case provider run is fully green; no failed run is counted as final acceptance. All recorded automated test executions total 444 (428 passed, 16 earlier failures). Remote public smoke and quality commands are reported separately. See [test summary](phase-f-evidence/test-summary.json) and [quality](phase-f-evidence/quality.json).

## Real Operations

| Operation initiated by Phase F | Count |
| --- | ---: |
| Real SaaS Outreach messages | 0 |
| Real AI Video inference | 0 |
| Real WaveSpeed/other LLM inference | 0 |
| Real payment charges | 0 |
| Real emails | 0 |

## Canary Result

**NOT RUN — NOT READY.** Shared developer-app values and an independent SaaS encryption key are provisioned. Callback routing, current app/grant review, internal-account exclusions, a live owned connection and a controlled recipient remain unresolved. Explicit canary approval has not been requested or assumed. There is no truthful READY FOR REAL CANARY claim at this stage.

Required operator preparation:

1. Continue with the existing developer app; do not require a second app solely because two applications share app-level credentials. Review its customer seller-authorization eligibility and required Affiliate messaging and creator-read grants. Native seller/shop grants must never substitute for Workspace authorization.
2. Resolve the observed callback routing limitation without interfering with the native callback. Partner Center settings and native routing were not changed by this task; any future change requires separately authorized work. Review the current token, expiry, scopes, exact Creator Open ID namespace, message-proof and rate-limit contracts.
3. Keep the reused app values and independent versioned SaaS keyring private. Configure the mandatory internal-account exclusion fingerprints before enabling onboarding. Record contract review only after completing it. Keep `OUTREACH_REAL_SEND_ENABLED=0` and `OUTREACH_PROVIDER_FIXTURE=0`; bulk remains disabled.
4. Use a dedicated QA Billing Account/Workspace with at least 10 Tokens, add its safe sender label, authorize the controlled seller through SaaS and run Verify connection. Select the intended account explicitly if multiple shops are returned.
5. Authorize exactly one controlled recipient and verify its exact provider identity through the private `register-recipient` operator command. Prepare the frozen message using the private `prepare` command. Proposed benign text for review: “Controlled QA certification. Please confirm receipt.” No real Workspace/channel/recipient is selected yet.
6. After readiness is verified, review the selected Workspace/channel, safe sender label, controlled recipient and exact message. Explicitly authorize **maximum one external message in a later turn**. Only then may the private `approve` command, temporary real-send gate and shared Outreach worker dispatch the exact approved campaign. No canary approval or real-send gate change was performed in Phase F preparation.
7. Manually confirm actual receipt afterward. Accepted proof plus correct 10-Token settlement and operator receipt confirmation is required before the private `certify` command. An ambiguous result holds 10 Tokens and must not be retried.

Private operator commands run from the SaaS directory using `node --env-file=.env.local --conditions=react-server --import tsx scripts/outreach-canary.ts`, with the existing signed-in allowlisted operator and explicit Workspace arguments. No credentials, passwords, cookies or provider tokens are command arguments. Required confirmations are `--controlled-recipient-authorized`, `--confirm-one-controlled-message` (after human approval), and `--receipt-confirmed` (after manual receipt). Do not paste secrets or authorization links into chat. The first canary reserves 10 Tokens, captures 10 for factual SENT, releases 10 for a definite unsent failure and retains 10 for DELIVERY_UNKNOWN.

## Remaining Deferred Work

Dedicated provider app/grants and fresh official-contract verification; real onboarding and canary; general creator-data authorization/discovery; authoritative unknown-status recovery API if available; provider-side revocation workflow; reviewed broad paid-beta release. The first canary cannot enable bulk sends. Phase 10 remains deferred.
