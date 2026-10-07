# Phase E — Outreach SaaS

## Outcome

**APPLICATION: PASS / REAL OUTBOUND PROVIDER: NOT CERTIFIED**. All application acceptance, Phase A–D regression, build, migration and artifact-secret gates pass. Real sending is deliberately unavailable. Phase 10 is not started.

Baseline: Phase A/B/C/D COMPLETE / PASS; Phase D implementation `e19b173bd2eb3ab29630dde22c862c4227385877`, documentation `c8a7a368985f503102dfa28815f0457479513e6b`. All acceptance runs use separately owned databases, private buckets and fake providers. No historical internal campaigns are assigned customer ownership.

Implementation commit: `e87651b10a8f4162a2fe45c6a6328293b3fa7890` — **Implement tenant-safe Outreach SaaS**. Documentation/evidence follows in a separate commit; neither commit is pushed automatically.

## Native Outreach Audit

[Phase E0 audit](phase-e-native-outreach-audit.md) was completed before implementation. The configured reference resolved to `C:\Data\TikTok Outreach`. Reviewed its Prisma schema, discovery/domain rules, API campaign lifecycle, freeze, reservations, outbox, worker, provider mutation adapter, encryption and governor; and the old `app` integration and one-click journal. Native campaign GETs can mutate expiry, so the audit did not call them. Database metadata/counts were read in a read-only transaction.

The native operator sender is selected through `activeShop()` and the examined controller does not enforce SaaS membership. Its sender IDs and credentials are unsuitable as customer authorization. Native per-shop integration ownership provides a useful model for a separate, workspace-owned channel abstraction.

## Native → SaaS Reuse Matrix

The complete 28-capability matrix and classifications remain in the unchanged E0 audit. The final implementation follows it:

| Native capability | Final SaaS decision |
| --- | --- |
| Filters, seven ranking metrics, three literal variables, 2,000-character message limit | REUSE semantics in bounded validation and deterministic selection; no native code import |
| Freeze, eligibility, reservation, cooldown, conservative unknown state | ADAPT semantics with SaaS transactions, immutable snapshots and channel scope |
| Atomic delivery/outbox and cooperative controls | REIMPLEMENT TENANT-SAFE worker, leases, pacing and controls |
| Campaigns, recipient/message history, billing and audit | REIMPLEMENT TENANT-SAFE in the SaaS database |
| Native `activeShop()`, internal authentication, raw credentials/contact metadata, internal campaign ownership | NOT CUSTOMER-SAFE; no proxy, selection, fallback or import |
| Authorized real account onboarding, live provider and real crawler data adapter | DEFER until independently reviewed and certified |

## Final Architecture

Forward migration `0015_outreach_saas.sql` adds SaaS-owned channels, private credential references, approved creator directory, campaigns, immutable config versions and recipients/messages, deliveries, attempts, outbox intent, contact state, reservations, health, reconciliation proofs, campaign billing and private TEST receipts. Composite foreign keys bind workspace, campaign, channel, recipient and delivery identities. Old migrations are untouched.

`src/lib/outreach-types.ts` is safe for the browser; validation/selection/accounting lives in `outreach-core.ts`. Server-only `outreach.ts` implements admission, quotes, history, controls and settlement. `outreach-worker.ts` and `scripts/outreach-worker.ts` implement asynchronous TEST processing. No runtime component imports the native sender, accesses its DB or invokes its API. PostgreSQL owns delivery intent; no Redis/BullMQ installation is needed.

## Workspace / Billing Account Isolation

Every channel and campaign belongs to one workspace. Campaigns, quotes, reservations, ledger entries and relevant audit events retain the shared Billing Account. Request authorization uses active workspace membership and explicit Outreach permission. Repeated role checks occur inside admission/control transactions. Billing Account membership grants no access to another workspace's channel, campaign, recipient, message or attempt.

The DB prohibits ownership reassignment and mismatched workspace/channel/campaign references. API requests cannot supply native sender/connection IDs, provider URLs, credential paths or raw tokens. Foreign reads/controls/quotes return safe 403/404. No export/download endpoint was introduced.

## Channel Integration Model

Channels carry provider, safe label, workspace, immutable account scope, status/capability, timestamps and a private encrypted-credential reference abstraction. Public DTOs exclude account scope, credential references, provider receipts and worker identities. Health is reduced to sending-service availability.

`TIKTOK_SHOP` can only be recorded as pending/unavailable. A DB constraint permanently denies connected status/outbound capability/credential assignment until a reviewed forward migration enables a certified adapter. TEST channels require local/test environment, explicit fake-provider flag, identical owned test DB URLs and a uniquely named `phase_e_*` database. The live customer DB fails that gate. No native/internal credential fallback exists. No real credentials were collected or encrypted in this phase; production encryption/key lifecycle remains an onboarding gate.

## Campaign State Machine

Admission immediately produces a frozen `QUEUED` campaign; discovery/freeze steps are durable audits rather than extra customer buttons. Processing uses `SENDING`, `PAUSE_REQUESTED`, `PAUSED`, `CANCEL_REQUESTED`, `DELIVERY_UNKNOWN`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, `FAILED` and `CANCELLED`. State is derived from authoritative delivery rows and control flags. Database guards reject impossible aggregate states, terminal restarts, premature sent outcomes, changed frozen identity, regressed attempts and changed leases.

Delivery states are `PENDING`, `DISPATCHING`, `RETRYABLE`, `SENT`, `RESTRICTED`, `FAILED`, `DELIVERY_UNKNOWN`, `CANCELLED`. Attempt history becomes immutable after its outcome is recorded. Unknown resolution requires immutable provider proof in the DB.

## Discovery / Recipient Snapshot

Only fields confirmed by E0 are supported: creator keyword/category, follower range, USD GMV range, units sold, video views, live viewers, engagement; ranking by GMV, units, followers, video views, live viewers, engagement or discovery relevance, in either direction. Selection has stable tie-breaks and deduplicates identity. Unsupported metrics/currency and malformed bounds are rejected.

The server reads at most 2,000 approved candidates per owned channel and supports 1–500 recipients. Preview includes selected count, shortfall and at most 20 safe creator summaries. TEST channels seed 12 synthetic controlled creators; these are never seeded into the live DB. The native 397,287-creator dataset was not imported or redistributed. Real data authorization and a controlled adapter are deferred.

Selected safe name/username/metrics, recipient identity, rank and rendered message/hash become immutable snapshots. Later directory changes cannot rewrite them. Do-not-contact, unknown outcome and active reservation exclude recipients; cooldown uses the workspace-owned channel, equivalent to native shop/account contact scope. An eventual real provider must enforce uniqueness/global provider limits across explicitly authorized connections before onboarding is enabled.

## Template / Message Freeze

Neutral editable English messages support exactly `creator_display_name`, `product_name`, `campaign_name`. Substitution is literal, with no expression evaluation, arbitrary code or replacement-string expansion. Product name is required when its variable is used. Source and expanded messages must be 1–2,000 characters. No internal company template, hidden contact method or provider metadata is exposed. Frozen bodies are returned only by the authorized campaign/recipient endpoint and never included in broad audits.

## One-Click Send Flow

The form shows eligible recipient count and a server-authoritative Token quote. One **Send Campaign** action rechecks ownership, channel authorization, configuration/quote identity and current eligibility under wallet/channel locks; then commits campaign/version, immutable recipients/messages, deliveries, outbox, contact reservations and one wallet reservation together. The browser returns to progress immediately and never synchronously sends messages.

Settings and a stable operation key survive refresh in workspace-scoped session storage. A recovery lookup retrieves an already admitted operation even if all its recipients are now excluded by that operation's own reservation. Starting another campaign explicitly creates another operation identity.

## Idempotency

Unique `(workspace_id, operation_key)` and a canonical configuration hash bind identity from the first creation. Five concurrent replays return the original campaign. Changed settings under that key conflict. Existing operation lookup precedes new quote/discovery validation, so an expired quote or lost response cannot create another campaign. DB uniqueness also enforces one version, recipient/delivery identity, outbox row and reserve/capture/release per quote. Retries do not create another reservation or charge.

Actual Chrome and Edge tests abort a reply after server commit, reload with all 12 recipients reserved, and recover exactly one campaign, 12 recipients/deliveries/outbox rows and one reservation.

## Outbox / Worker

The worker polls durable DB intent and claims a lease/attempt transactionally before provider execution. It serializes each channel, permits one active dispatch per channel and enforces a minimum 1-second interval. Definitive temporary pre-send failures/rate limits use backoff and at most three attempts; permanent restriction/failure stops. Contact eligibility is checked again at dispatch. Heartbeats expose only simple availability.

The runnable worker is deliberately isolated TEST only:

```text
node --conditions=react-server --import tsx scripts/outreach-worker.ts
```

The command must receive the owned acceptance environment; it refuses the normal live database even if someone sets the fake flag. The acceptance harness supplies that environment privately. It is not a certified production sender command.

Four actual worker process kills prove recovery before claim, after claim, after provider proof but before completion, and after completion but before settlement. Stale leases are rejected. No missing in-memory queue call can lose delivery intent; settlement sweeps repair completed campaign accounting. TEST receipts persist provider evidence separately from the completion transaction, with at most one simulated send per delivery.

## Pause / Resume / Cancel

Pause prevents new claims at the locked channel boundary. An already active delivery may finish, after which the remaining recipients stay paused. Resume continues the original frozen recipients; it does not repeat sent rows. Cancel terminalizes unsent pending/retryable rows and retains sent/in-flight/unknown history. Cancellation cannot revoke an already sent message. Actual in-flight pause and cancel tests finish one active delivery, leave three unsent and settle 10 captured / 30 released.

## Delivery Unknown

Ambiguous provider response or expired dispatch lease becomes `DELIVERY_UNKNOWN`. No automatic retry occurs; creator exclusion and the campaign reservation remain. The campaign stops new dispatches until evidence is reconciled. The browser cannot post a desired outcome.

Server-side TEST evidence can confirm SENT or NOT_SENT; PENDING evidence remains unresolved. Atomic TEST-provider absence proves no simulated submission only for this isolated adapter. That inference must never be reused for a real provider without its own proof contract. Confirmed NOT_SENT may retry within the bound; cancellation/inactive connection resolves it to a non-send terminal outcome. Read-only proof reconciliation can settle a disconnected TEST channel without enabling another send.

## Billing Model

OUTREACH has immutable TEST and PRODUCTION price versions labelled **INTERNAL BETA**, policy `outreach-confirmed-send-v1`: **10 Tokens per confirmed successful send**. This is temporary technical acceptance pricing; final commercial pricing is not approved.

Reserve `10 × eligible frozen recipient count` at atomic admission from the Phase C shared account wallet. Once every outcome is definite, capture `10 × SENT`, release the remainder, exactly once. The whole campaign's maximum remains reserved until all outcomes are definite; even confirmed partial successes are not captured while another delivery is unknown. Retries have no additional reservation/charge. Append-only ledger entries bind the immutable campaign quote; old job/payment accounting and historical rows are preserved.

## Partial Failure / Cancel Accounting

| Outcome | Capture | Release / hold |
| --- | --- | --- |
| Invalid configuration/channel/quote or failure before admission | 0 | No reservation |
| Cancel four recipients before dispatch | 0 | Release 40 |
| One SENT, three unsent then cancel | 10 | Release 30 |
| Two SENT, one RESTRICTED, one FAILED after evidence resolves ambiguity | 20 | Release 20 |
| Three bounded definitive failed attempts | 0 | Release selected maximum once |
| Any pending, active, retryable or unknown delivery | Deferred | Hold the full maximum until definite |
| Crash after completion, before settlement | Exact confirmed sends | Restart sweep settles once |

Wallet locks, nonnegative DB constraints and exact ledger amount guards prevent overspending. Two parallel 20-Token campaigns against 30 available yield one admission and one 402, with 10 available / 20 reserved. Reconciliation accounts for both job and Outreach reservations and detects unsettled terminal campaigns or inconsistent Outreach settlement.

## Shared Wallet

Controlled Brand A and Brand B share the same Billing Account. A four-success campaign reduces both visible balances from 1,000 to 960. Brand B receives no campaign or channel data. A separate account retains 1,000 and owns separate channels/campaigns. New workspaces retain Phase C's zero-wallet/shared-account behavior.

## Permissions

| Workspace role | View | Create/quote | Send | Manage/control | Channel manage |
| --- | --- | --- | --- | --- | --- |
| Owner / Admin | Yes | Yes | Yes | Yes | Yes |
| Editor | Yes | Yes | No | No | No |
| Viewer | Yes | No | No | No | No |

Account Billing permissions remain separate. Audit records workspace, account where relevant, actor for customer actions, campaign, safe event and counts/amounts. Events cover channel connection/request/disconnection, creation/discovery/freeze/queue, pause/resume/cancel, delivery outcomes/proof, completion and reserve/capture/release. No message body, raw provider response or credential appears in broad audit metadata.

## Campaign UX

English pages: `/outreach`, `/outreach/new`, `/outreach/[campaignId]`, `/outreach/channels`. Navigation and workspace switching follow the existing shell. The form has sender, targeting, optional additional metric filters, literal message editor, selected preview, required/available Tokens and one action. Detail shows DB counts, started/completed times, safe controls, saved message inspection and charge/release history. Channel settings show workspace ownership, unavailable real integration, explicit TEST status and sending-service availability.

Customers do not see outbox/lease/worker IDs or provider sessions. Insufficient Tokens visibly disable sending, with Required/Available amounts; the server still rejects a stale submission.

## Browser / Responsive

Actual installed Chrome and Edge cover all four pages at 1440×1000, 768×1024 and 390×844, with light/dark themes: 48 page/layout checks plus form submission, refresh, pause/resume, background completion, message view, lost reply and insufficient balance. Normal flows require no horizontal overflow, page/console/network error or detected secret. The deliberately aborted admission response is an explicit fault injection. Screenshots and safe observations reside in `phase-e-evidence/`.

The updated production SaaS is running on `127.0.0.1:3200`, with local health HTTP 200. An additional anonymous public HTTPS smoke on `ai-test.proyaofficial.com` passes in Chrome 154.0.8037.98 and Edge 154.0.4258.62: login, registration, forgot-password and invalid verification/reset pages return HTTP 200, without development-mailbox wording, reflected token markers, detected secrets or page errors. Remote health returns 200. This smoke creates no accounts, sends no email and does not submit authenticated campaigns; the complete authenticated acceptance uses isolated TEST infrastructure. Response-body reads are bounded to prevent a stalled public response from hanging the smoke; a transient Edge launch failure was rerun successfully and is separate from the zero-retry acceptance suites.

## Security / Secret Audit

Audit covers HTML/JS/API/browser console, production browser bundles, source, logs, reports, working tree and staged Git; findings contain only categories and file paths. Native sender/DB credentials are never returned by the Outreach API. Fake providers require strict owned isolation, private configuration remains ignored and unchanged, and no complete authentication links or cookies belong in evidence.

One initial audit search accidentally emitted an ignored legacy database connection string into the tool transcript. It was disclosed immediately. It was not copied into customer responses, reports, committed evidence or Git, and no credentials/configuration were changed. Final clean artifact scans do **not** erase that session incident; zero transcript exposure is not claimed. The final scan result records this distinction explicitly.

## Native Preservation

Read-only final checks compare all 264 native source/configuration hashes and the same native DB metadata fingerprint across 41 tables (`7bfb7d99ca2516028a346561813716bbdd8e309de59e314024faa4afc3e2691b`). Native code, credentials, schemas, sender identity, ports, services and Cloudflare tunnel are not changed. The old internal AI Site is untouched. No native campaign history/contact data was imported.

## Phase A-D Regression

All prior 360 evidence/document files remain byte-identical. The isolated Phase E harness passed AUTH/SMTP behavior, workspace creation/switching/isolation, Products/reference slots, AI Video, Clipper/variations, shared billing, Content Library, private storage and worker restart/recovery. Real SMTP certification from Phase B remains preserved; current regressions use development-file mail only and do not contact the receiving mailbox.

## Tests

**337 passing executions / 300 distinct cases** (unit cases plus unique Playwright scenario titles), zero failures, retries or skips. The 37 repeated executions are the integration cases included again by the full browser command and focused isolation regressions.

| Suite | Passed |
| --- | ---: |
| SaaS unit | 103 |
| Worker unit | 82 |
| `npm run test:integration` | 35 |
| `npm run test:browser` | 41 |
| Phase C shared wallet | 13 |
| Phase D variations | 8 |
| Phase D actual process recovery | 5 |
| Phase D Chrome/Edge editor | 2 |
| Phase D focused isolation/lost reply | 3 |
| Phase A focused | 6 |
| Phase A actual process recovery | 7 |
| Phase B customer/auth/SMTP behavior | 8 |
| Phase E API/accounting/safety | 13 |
| Phase E actual process recovery/control | 6 |
| Phase E Chrome/Edge/customer UI | 5 |

Commands passed: `npm run test:unit`, `npm run test:integration`, `npm run test:browser`, `npm run lint`, `npm run typecheck`, `npm run build`; worker `python -m unittest discover -s tests -v`.

Dedicated matrix: A basic campaign; B concurrent replay/lost reply; C mixed outcomes; D pause/resume; E exact cancel accounting; F four worker kill windows; G shared wallet; H foreign IDs; I separate accounts; J insufficient/concurrent wallet; K cooldown/freeze/exclusion; L unknown evidence/no blind retry. Additional tests cover database guards, roles, post-freeze eligibility, rate-limit pacing and disconnected proof reconciliation.

## Real Operations

Real Outreach sends **0**; real AI Video inference **0**; real WaveSpeed LLM analysis **0**; real payment charges **0**. All messages/deliveries are simulated controlled TEST recipients. This phase triggers no real registration/recovery email, accesses no mailbox and changes no SMTP credentials. No sandbox or real recipient send was authorized or attempted.

## Data Mutation Summary

Applied only forward migration `0015_outreach_saas.sql` and its two internal-beta price versions to the live SaaS database. Its SHA-256 is `5d5e7378c0fe6a4c1a33fb5cb1996c20d0dfc5d07e84dc6214a21c224ecf9bb2`; the live schema exactly matches the independently rebuilt/tested schema. The 22 baseline customer/history table fingerprints, all earlier migration hashes and the live account wallet total of **5,080 available / 0 reserved** match before/after. No live TEST channel, creator, campaign, recipient, delivery, receipt or token entry is created. No existing content/job/variation/customer data is rewritten. Isolated test DBs/buckets/gateways and QA mail fixtures are removed; all owned test workers stop. PostgreSQL, storage, native services, tunnel and operator worker-agent remain under their existing management.

Those before/after figures describe the atomic migration, as preserved in `live-migration.json`. After restarting the SaaS, the operator submitted two Clipper jobs and confirmed their ownership in this chat. Normal job/quote/attempt/artifact/checkpoint records were appended, source-validation metadata changed and 1,200 Tokens were reserved. At the final runtime snapshot the wallet is **3,880 available / 1,200 reserved**, exactly matching its ledger. These jobs and their billing history were preserved; no settlement, removal or feature repair was performed as part of Phase E.

The strict whole-table comparison consequently records `LIVE_HISTORY_CHANGED` in `preservation.json`; it is retained rather than overwriting the baseline. Supplemental read-only `runtime-preservation.json` verifies the original rows in all 20 other baseline tables still match byte-equivalent row fingerprints, all new job-linked rows belong to the two confirmed Clipper jobs, all new quotes are Clipper quotes, source identity remains guarded, and live Outreach tables remain empty. Wallet and source-validation metadata are the two explicitly identified runtime updates. The original migration/native/private-configuration/evidence preservation checks remain valid.

## Real Provider Certification

**REAL OUTBOUND CONNECTION: NOT CERTIFIED. REAL OUTBOUND PROVIDER: NOT CERTIFIED.** Application acceptance is limited to the tenant-safe connection abstraction and deterministic TEST provider. Live OAuth/session onboarding, account authorization/scopes, delivery evidence, quota/global pacing and a controlled sandbox canary require a separate reviewed gate and explicit operator authorization before any external send.

## Deferred Work

Phase 10 — **not started**. Real provider adapter/onboarding, private encryption/key lifecycle, approved creator-data adapter/authorization, real identity uniqueness/global provider limits and sandbox acceptance remain deferred. No real campaign can be sent by this implementation. Current bounded limits are 10 channels/workspace, 10 active campaigns/workspace, 2,000 approved candidates/channel, 500 selected recipients/campaign, three definitive pre-send attempts, 15-minute quotes and at least 1-second channel pacing. Production scale/provider contracts and final commercial pricing are not certified.
