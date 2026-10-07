# Phase E0 — Native Outreach Read-only Audit

Audit completed before SaaS implementation on 2026-10-07. Native path **C:\Data\TikTok Outreach** was resolved from `app/docs/existing-systems-inventory.md` and the old integration's configured reference; it was not guessed. No campaign, discovery, freeze, send, pause, resume, cancel or reconciliation action was submitted to native services. Native source/configuration/database/services remain untouched.

## Reference and Runtime

Reviewed `packages/db/prisma/schema.prisma`, domain preview/filter/template rules, API Outreach controller/service/local-preview, native queue reconciliation, outbound worker dispatch/recovery/governor, token encryption and real mutation adapter; and `app/src/lib/integrations/outreach/` plus its integration/production/security documentation.

Runtime inspection was reduced to allowlisted predicates: native API and outbound worker use `APP_MODE=read_only`, `OUTBOUND_MODE=live`; discovery and history workers are separate. Observed ports 3000/4000/5432/6379 listen on loopback. Old AI Site has login disabled and native queueing enabled. Native GET campaign list/detail can expire campaigns; no such GET was called. Native schema was inspected in `BEGIN READ ONLY`, without selecting credentials/messages/contact records. Schema fingerprint covers 41 tables; baseline counts include 2 Shops, 46 Campaigns, 13,081 recipients, 4,212 deliveries/outbox entries and 397,287 Creators. These are observations, not tenant ownership or permission to reuse their data.

Preservation manifests retain hashes for 264 native source/config files, 360 prior SaaS evidence/documents, private SaaS/worker/legacy config and 22 SaaS customer/history tables. Live shared wallet baseline is 5,080 available / 0 reserved. Native schema SHA-256: `7bfb7d99ca2516028a346561813716bbdd8e309de59e314024faa4afc3e2691b`.

An initial broad search accidentally included ignored legacy configuration and emitted a database connection string into the tool transcript. No value is repeated or committed here. Subsequent configuration reads use redacted predicates/hashes; this session incident must be distinguished from customer response, log, bundle and Git secret scans.

## Native Capability Matrix

| Native capability | Existing behavior | Safe for SaaS reuse? | Phase E action |
| --- | --- | --- | --- |
| Campaign lifecycle | DRAFT → DISCOVERING → PREVIEW_READY → FROZEN → QUEUED/RUNNING, pause/safety/terminal states | Patterns only; native IDs have no SaaS owner | ADAPT |
| Creator discovery | Persisted shop-specific Creator metric snapshots; exact verified Creator Open ID | Requires explicit data authorization, never browser/native DB access | DEFER real dataset; REIMPLEMENT TENANT-SAFE directory boundary and TEST fixtures |
| Filters | Username/nickname keyword, category IDs, follower bounds, GMV/currency bounds, units, video views, live viewers, engagement | Pure validated predicates | REUSE semantics; bounded SaaS validation |
| Ranking | GMV, units, followers, video views, live viewers, engagement, native relevance ordinal; ASC/DESC | No remote inference required | REUSE deterministic ordering with stable tie-break |
| GMV | Production stored Marketplace USD; mock IDR; no FX conversion | Currency must remain explicit | ADAPT; test directory uses USD and rejects unsupported currency |
| Recipient preview | Eligible/excluded/selected, reason/count/shortfall; bounded candidates | Native records/contact internals cannot be exposed | REIMPLEMENT TENANT-SAFE safe preview and workspace snapshot |
| Freeze | Recheck shop eligibility/reservations, immutable recipient ID/message/hash/context, 30-minute expiry | Transactional pattern is useful | ADAPT; SaaS quote expiry and immediate atomic freeze/queue, no manual freeze UX |
| Reservation | Unique shop/creator, locks, exclusion of active reservation | Shop is not a SaaS Workspace | REIMPLEMENT TENANT-SAFE channel/creator reservation |
| Cooldown/exclusion | Shop-specific do-not-contact, unresolved delivery and last contact; unresolved historical identities reported | Must not mix internal/customer history | ADAPT to Workspace-owned authorized channel; no global history import |
| Message template | Literal `creator_display_name`, `product_name`, `campaign_name`; ≤2,000 chars, no execution | Safe allowlist semantics | REUSE; new neutral customer-editable English default, no internal company claims/contact text |
| Frozen message | Per-recipient rendered body and hash; later template cannot rewrite it | SaaS-owned immutable data required | REIMPLEMENT TENANT-SAFE |
| Sender identity | Campaign create calls `activeShop()`; provider uses authorized shop cipher/token | Current operator active shop cannot represent SaaS authorization | NOT CUSTOMER-SAFE current sender selection |
| Integration ownership | Native IntegrationConnection stores per-shop status/scopes/encrypted tokens | Useful model; native ownership is separate | REIMPLEMENT TENANT-SAFE Workspace-owned channel/credential reference |
| Credential encryption | AES-256-GCM, private key; no plaintext fallback | Pattern only; never copy native credentials/key | ADAPT private reference abstraction; real onboarding deferred |
| Native authentication | Examined Outreach controller has no route credential guard; private loopback/operator access | No SaaS membership/role enforcement | NOT CUSTOMER-SAFE; never proxy native campaign/send IDs |
| Queue/outbox | DB delivery+outbox intent committed atomically; deterministic BullMQ publication and sweepers | Durable pattern independent of Redis | REUSE semantics; PostgreSQL SaaS outbox is authoritative, no new Redis dependency |
| Dispatch worker | Provider admission, heartbeat, safe state checks, cooperative controls | Native worker uses internal provider identity | REIMPLEMENT TENANT-SAFE TEST adapter/worker; never invoke native sender |
| Retry | Bounded temporary pre-send failures, backoff/Retry-After, no automatic mutation HTTP retry | Outcome classification reusable | ADAPT bounded definitive pre-send retries |
| Delivery unknown | Ambiguous SEND_MESSAGE response or DISPATCHING after crash → DELIVERY_UNKNOWN; block creator, reconcile | Essential duplicate protection | REUSE conservative semantics; provider evidence required before SENT or retry |
| Pause/resume | PAUSE_REQUESTED; no new dispatch at boundary; existing in-flight may finish; safety pauses require fix | Membership/tenant checks missing natively | REIMPLEMENT TENANT-SAFE |
| Cancel | Cancel unsent RESERVED/QUEUED, retain sent/in-flight outcomes and history | Cannot revoke delivered messages | ADAPT safe cancellation and exact partial settlement |
| Pacing | Shop timezone daily limits, channel interval, app/provider/shop governor, quota safety pauses | Real account/global limits need provider contract | ADAPT serialized channel pacing and test rate-limit behavior; DEFER real provider/global certification |
| History/progress | Authoritative DB frozen/queued/processing/terminal counts, immutable delivery attempts | Internal data cannot be inherited | REIMPLEMENT TENANT-SAFE customer counts/history/timing |
| Creator/contact privacy | Native Open IDs, raw metrics payload, hidden history/identity linkage | Excessive disclosure | NOT CUSTOMER-SAFE raw native contact/metadata; expose only safe approved snapshot fields |
| Outer create idempotency | Native create lacks a general operation key; clone has narrower idempotency | Lost create reply cannot safely replay | REIMPLEMENT TENANT-SAFE key from first creation, DB uniqueness/hash binding |
| Old one-click AI Site | Local journal + single-flight create/discover/freeze/send, then native DB overview; no-login runtime | Existing sender/auth/journal are not tenant-safe | ADAPT simple UX; REIMPLEMENT durable SaaS operation identity and permission checks |
| Database ownership | Native Prisma DB owns internal campaigns/crawler/provider history | Cannot become SaaS source of truth | NOT CUSTOMER-SAFE import without proof; all new customer state lives in SaaS DB |
| Native template/diagnostics endpoints | May expose internal company message, provider/session/worker details | No customer requirement | NOT CUSTOMER-SAFE; no browser/native API access |

## Safe Sender Boundary and Decision

A safe boundary can be designed: native code already distinguishes shop authorization/credential state from campaign state, but its operator `activeShop()` selection and unguarded campaign API cannot enforce customer ownership. **Proceed with new SaaS-owned entities, not a proxy to that sender.** Channel identity belongs to one Workspace; a shared Billing Account grants no channel or campaign access. Requests cannot supply native shop IDs, native connection IDs, provider URLs, tokens or credential paths.

The initial runnable provider is explicitly TEST, gated to nonproduction isolated acceptance and populated only with controlled QA identities. A real-provider channel may exist only as a disconnected abstraction, with no outbound capability. No real adapter/native credential fallback is implemented. Real native/crawler data use requires reviewed customer data authorization and an approved server-side source adapter. This is **REAL OUTBOUND CONNECTION: NOT CERTIFIED**, not a claim of real send parity.

## Planned SaaS Safety Contracts

One customer Send Campaign action binds a server-authoritative quote/config/recipient snapshot, rechecks channel/eligibility under locks, and atomically persists the campaign/version, frozen recipients/messages, deliveries, outbox intent and one account reservation. All identifiers are Workspace-bound. Queue processing is asynchronous and independent of the browser request.

Proposed temporary versioned INTERNAL BETA price: 10 Tokens per confirmed successful send, reserve at most 10 × eligible frozen recipients. Final known outcomes capture confirmed sends and release the remainder once. Unknown deliveries hold the reservation until provider status evidence resolves them; no guessed success/failure or blind retry. Native internal billing/history remains untouched.

Cooldown and exclusions are scoped to the Workspace-owned authorized channel, equivalent to native shop/account contact scope. Active reservations and unresolved delivery block reselection even with cooldown 0. A real account must not later be attached to multiple customer identities without an explicit reviewed account-sharing/global-pacing policy; real connection implementation is deferred.

## Audit Limits / Deferred Certification

No real creator message or sandbox canary was sent. No real recipient/account was designated or authorized. Native services remain private and unchanged. This audit establishes behavioral patterns and a fail-closed tenant abstraction; it does not certify provider OAuth, TikTok permissions, live delivery, account-level global limits or lawful redistribution of the internal crawler dataset. Those are separate acceptance gates. Phase 10 is not started.
