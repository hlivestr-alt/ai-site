# Phase C — Shared Account-Level Token Wallet

## Outcome

**COMPLETE / PASS — 6 October 2026.** The controlled remote-test database has been migrated and the production SaaS build is running on port 3200 at https://ai-test.proyaofficial.com.

The 21 existing workspaces now resolve to 14 shared account wallets. Global available Tokens remain **5,080 → 5,080** and reserved Tokens remain **0 → 0**. There was zero Token loss, duplication, migration grant, or new ledger entry. All 113 original Master Acceptance and Phase A/B evidence files retain their original SHA-256 fingerprints.

Implementation commit: `7d5b30029baa1b40cab7e230edac5e32b1c94e89` — Implement shared account token wallet. No push was performed.

## Final Architecture

```text
Billing Account
├── explicit account owner / manager membership
├── one ledger-backed Account Wallet
└── Workspaces / Brands
    ├── immutable billing-account relationship
    ├── workspace membership and private data
    └── Workspace Jobs → frozen Quote → Account reservation / settlement
```

`billing_accounts`, `billing_account_members`, and `billing_account_wallets` are distinct from users and workspaces. `workspaces.billing_account_id` is mandatory and immutable. The append-only `token_ledger_entries` remains authoritative; the account wallet is a guarded SQL projection. The old `workspace_wallets` table has been removed, with no competing spendable projection or compatibility view.

Quotes, Job billing, payments, ledger entries, and new billing audit records carry the account identity while retaining workspace attribution. Composite foreign keys enforce Account + Workspace + Quote/Job/Payment/ledger identity. Products, references, sources, Jobs, Content Library, versions, workflows, workspace access, and private media continue to use workspace boundaries.

## Migration Strategy

Forward migration: `0013_shared_billing_accounts.sql`. Applied SHA-256: `69fe18e6b40aa467f1a95bd17aab23cebdd7bd874c0e1e25140d01a3151d72e6`. The new file has an explicit CRLF checkout rule to keep the migration runner's byte fingerprint stable. Previously applied migration files were unchanged.

Workspaces are grouped only where the durable original creator remains the sole active workspace owner. Invited membership never merges accounts. A workspace with multiple active owners is conservatively kept in a separate account; missing original ownership or conflicting creator evidence aborts the migration. All 21 live workspaces had an unambiguous original creator who remained the sole active owner; ambiguity count was zero.

Before applying, the live columns, constraints, triggers, functions, and indexes matched a fresh database built from the existing migrations. Migration checksums, ownership, economic totals, and full historical row fingerprints were rechecked. The SaaS was stopped during the transaction. Table locks, preconditions, aggregation, strict reference backfill, conservation checks, and post-migration historical fingerprints all ran before COMMIT. A failed gate rolls back; no support adjustment is used to hide drift.

Legacy ledger keys retain their original workspace meaning under `LEGACY_WORKSPACE` migration metadata. New entries use the account idempotency namespace, including a unique Account + key index. This preserves historically repeated keys across brands without manufacturing grants or rewriting original keys, deltas, IDs, reasons, or timestamps.

[Read-only inventory](phase-c-evidence/live-inventory.json), [isolated historical migration proof](phase-c-evidence/migration.json), and [live transaction proof](phase-c-evidence/live-migration.json).

## Existing Workspace → Account Mapping

Labels below are stable inventory pseudonyms. Personal names, email addresses, and customer identifiers are omitted. Each account's value equals the exact sum of its constituent old workspace projections.

| Account / original creator | Existing workspaces | Available after | Reserved after |
| --- | --- | ---: | ---: |
| Customer 1 | Workspace 1, 2, 8, 13 | 0 | 0 |
| Customer 2 | Workspace 6 | 0 | 0 |
| Customer 3 | Workspace 11 | 0 | 0 |
| Customer 4 | Workspace 9 | 0 | 0 |
| Customer 5 | Workspace 21 | 0 | 0 |
| Customer 6 | Workspace 4 | 0 | 0 |
| Customer 7 | Workspace 17 | 0 | 0 |
| Customer 8 | Workspace 14, 15 | 5,080 | 0 |
| Customer 9 | Workspace 10 | 0 | 0 |
| Customer 10 | Workspace 5, 7, 12, 20 | 0 | 0 |
| Customer 11 | Workspace 19 | 0 | 0 |
| Customer 12 | Workspace 18 | 0 | 0 |
| Customer 13 | Workspace 3 | 0 | 0 |
| Customer 14 | Workspace 16 | 0 | 0 |

## Before / After Accounting Proof

| Controlled live inventory | Before | After |
| --- | ---: | ---: |
| Users | 19 | 19 |
| Workspaces | 21 | 21 |
| Spendable wallet projections | 21 workspace | 14 account |
| Available Tokens | 5,080 | 5,080 |
| Reserved Tokens | 0 | 0 |
| Ledger available/reserved sums | 5,080 / 0 | 5,080 / 0 |
| Ledger entries | 35 | 35 |
| Job billing rows | 17 | 17 |
| Payments / payment events | 0 / 0 | 0 / 0 |
| Quotes | 51 | 51 |
| Outstanding reserved Job billing | 0 | 0 |
| Projection / reservation drift | 0 / 0 | 0 / 0 |

Full original-column fingerprints match for all 35 ledger entries, 17 Job billing rows, 51 quotes, payments/events, 20 Jobs, 54 reference asset versions, 12 Product versions, and 12 accuracy-rule versions. Account identity and ledger key-scope columns are the only historical billing metadata additions. No historical economic delta, frozen input, price, reference, timestamp, or customer data was changed.

The isolated historical fixture additionally preserved **9,923 available and 1,160 reserved** Tokens, including **9,000 available and 1,160 reserved** assembled from two brands. Its purchase, reserve, capture, release, repeated legacy keys, and historical reference fingerprints all survived. Drift and ambiguous ownership attempts aborted and rolled back.

## Concurrency Proof

Both brands resolve and lock the same SQL account-wallet row before admission. With 1,000 available Tokens, two simultaneous 700-Token requests returned **201 and 402**. Exactly one Job and one RESERVE were admitted; the account held **300 available / 700 reserved**, never negative. Cancelling the winning Job restored 1,000 available once.

[Concurrency evidence](phase-c-evidence/concurrency.json).

## Job Billing Proof

Scenario A used ordinary paid-mode admission with isolated fake providers: both brands saw 10,000; Brand A reserved and captured **560** for AI Video, and both saw **9,440**; Brand B reserved and captured **600** for Clipper, and both saw **8,840**. Each Job produced one RESERVE and one CAPTURE, with account/workspace audit attribution.

Quotes freeze the durable account, workspace, input/request hashes, price version, amount, expiry, and quote hash. Server admission remains authoritative after stale or insufficient quotes. Cross-workspace quote reuse and mismatched account references fail. Reservation, capture, release, and refund preserve the original account and original workspace Job identity. Captures still require a succeeded attempt, sealed READY artifacts, and durable publication intent; uncertain provider outcomes retain reservations.

A definite 600-Token Clipper failure returned the shared account to 10,000 with one RELEASE despite repeated settlement. Existing fake success, failure, ambiguous submission, retry, sealing, and free content-operation regressions also passed.

[Shared spend](phase-c-evidence/shared-spend.json), [failure release](phase-c-evidence/failure-release.json), and [quote/UI state](phase-c-evidence/shared-ui-chrome.json).

## Retry / Recovery Proof

The dedicated shared-account worker-loss case kept the original 600-Token reservation through LOST → SUCCEEDED attempts, rejecting late completion from the expired lease. Its final ledger contained one RESERVE and one CAPTURE.

Six actual Python worker process interruption cases passed at downloading, transcription, analysis, rendering, upload, and finalization. Every case used two brands sharing one account, retained the same 600-Token reservation, completed on a second attempt, advanced fencing, published once, and left both brands with identical balances. Storage transfers, media probes, and FFmpeg rendering were real; transcription and moment analysis used isolated fixtures. The existing retry bound test stopped at three lost attempts and released once.

Only the opt-in test adapter was extended to accept the explicitly isolated Phase C loopback environment. Deployed worker behavior and the normal worker process were untouched.

[Shared retry](phase-c-evidence/shared-retry.json), [six process recovery cases](phase-c-evidence/restart-run.json), [finalization interruption](phase-c-evidence/restart-finalizing.json), and [retry bounds](phase-c-evidence/restart-bounds.json).

## Payment / Purchase Proof

A fake payment initiated in Brand B credited the shared account with **10,000 Tokens** after verified PAID status. Three verified event deliveries produced one PURCHASE. Brand A immediately saw the same increased balance and account-wide payment history included Brand B attribution.

Provider abstraction, authenticated callbacks, package/amount/currency checks, payment state, and durable purchase references remain intact. Normal workspace membership does not authorize purchases. No real payment was created or charged.

[Purchase proof](phase-c-evidence/purchase.json) and existing integration payment/callback regressions.

## Refund / Adjustment Proof

A captured 560-Token Job refund restored the shared account once. Replaying the same support key was idempotent; a second refund key was rejected. An explicit account adjustment of -40 left both brands at 9,960. A mismatched account and reuse of an account support key with another brand were rejected.

Support commands now require `billingAccountId`, `attributionWorkspaceId`, active allowlisted operator identity, reason, and stable key. Account ownership is verified under the wallet lock before mutation. Operator, account, workspace, reason, and amount remain audited. Fixture grants use this same path only in isolated test databases; migration used zero grants or adjustments.

```text
billing-support.ts grant|adjust|refund billingAccountId attributionWorkspaceId operatorUserId stableKey integerAmount|jobId "reason"
```

[Refund and adjustment proof](phase-c-evidence/refund-adjustment.json).

## Workspace Isolation Proof

A user with legitimate access to Account X and Account Y saw **5,000 and 800** respectively. Switching A → B inside X preserved 5,000; switching to Y returned 800. Foreign workspace billing and quote IDs were rejected, and ordinary workspace/account movement failed.

Sharing billing did not grant sibling Products, references, Jobs, sources, Content Library, or media access. The limited team case denied real sibling Product/reference-download, Job, source-download, and Content endpoints. Existing workflow lineage, direct-ID authorization, scoped signing, and private storage tests remain green. Data-domain queries continue to use workspace identity; only authorized billing history aggregates by account.

[Account isolation](phase-c-evidence/account-isolation.json), [team privacy](phase-c-evidence/team-privacy.json), and [scoped storage checks](phase-c-evidence/test21.json).

## Team / Billing Authorization

Explicit ACTIVE account OWNER/MANAGER membership controls account-wide history and purchases. Existing sole original creators receive account ownership during migration. Invited workspace owners/admins/editors are not automatically account billing managers.

An invited workspace ADMIN could spend through authorized operations and see only that workspace's history; purchases and sibling creation were denied. An explicit account MANAGER grant enabled appropriate account history with brand labels while leaving the sibling workspace absent from the workspace list and its private data inaccessible. Sibling Job links are suppressed when workspace access is absent. Workspace usage remains local to the selected workspace.

Account creation, owner membership, zero wallet, and initial workspace are transactional. Ten simultaneous initial workspace requests created one account, one empty wallet, ten valid workspaces, and zero ledger entries. Creating Brand C within a funded account reused its 10,000 balance, produced no funds or ledger copy, and retained one wallet.

[Atomic onboarding](phase-c-evidence/onboarding.json) and [new workspace proof](phase-c-evidence/new-workspace.json).

## UI Changes

Billing now displays **ACCOUNT BALANCE**, **Shared across your workspaces**, available/reserved Tokens, and appropriate workspace attribution in history. Billing management and Create workspace controls follow explicit account permissions.

Actual Chrome **154.0.8037.98** and Microsoft Edge **154.0.4258.53** passed shared billing, A → B → A → B switching without browser reload, brand creation, separate-account switching, and both AI Video and Clipper quote forms. A sibling 560-Token reservation reduced the displayed 1,000 balance to 440; insufficient buttons disabled, and refreshing after release restored eligibility. No page crash or response/console secret leak was detected.

Authenticated financial/UI acceptance used disposable local databases, private storage, and fake providers/payments. After deployment, both actual browsers separately passed the public HTTPS smoke: login, registration, recovery, clean verification/reset HTML, and health 200. Public smoke made zero remote data mutations and sent zero real emails.

[Chrome](phase-c-evidence/shared-ui-chrome.json), [Edge](phase-c-evidence/shared-ui-msedge.json), and [remote HTTPS smoke](phase-c-evidence/remote-public.json).

## Reconciliation

Account available and reserved projections match the account ledger sums. Outstanding reservations aggregate all constituent workspaces. Quote/Job account and workspace binding, input/price identity, Payment/account match, verified purchase settlement, and both directions of refund reference/state matching are checked.

The isolated drift case was reported without rewriting the projection. The live read-only report returned zero issues in all twelve categories, including wallet, reserved Jobs, quote/account, ledger/account, payments, refunds, and late settlement. No arbitrary balance repair was performed.

[Isolated reconciliation](phase-c-evidence/reconciliation.json) and [live reconciliation](phase-c-evidence/live-reconciliation.json).

## Phase A/B Regression

**PASS.** AUTH signup, encrypted mail queue, verification plumbing, sessions, and password recovery remain covered by the existing unit/integration suites and eight customer regression cases. The previously completed real remote SMTP certification in `d98bb04b65e8853919ed4ac56bf2498f03d7e0b1` remains intact; this phase did not send real SMTP mail or change credentials.

Repeated switching, direct-ID isolation, eight Product reference slots, upload/replacement, cover, frozen lineage, active AI Video reopening, real worker recovery, scoped signing, corrupt media rejection, safe worker errors, and browser behavior all passed. All 113 original acceptance evidence/report files match the before hashes. New evidence is stored exclusively in `docs/phase-c-evidence`.

The final secret audit found no configured credentials, auth links, or session cookies in the inspected working tree, staged evidence, SaaS output, or test logs. The test harness now stores acceptance summaries without Playwright environment metadata and masks session cookies in failure diagnostics. Initial ignored reporter metadata was sanitized before certification; an audit-helper side effect on one original evidence file was restored byte-for-byte and verified against its preserved hash.

[Final secret and evidence-preservation audit](phase-c-evidence/secret-audit.json).

## Tests

| Final recorded suite | Passed | Failed / skipped |
| --- | ---: | ---: |
| `npm run test:unit` | 82 | 0 / 0 |
| Worker `python -m unittest discover -s tests -v` | 74 | 0 / 0 |
| `npm run test:integration` | 35 | 0 / 0 |
| `npm run test:browser` | 41 | 0 / 0 |
| Dedicated Phase C acceptance | 13 | 0 / 0 |
| Phase A focused security/media | 6 | 0 / 0 |
| Actual worker interruption/retry | 7 | 0 / 0 |
| Phase B customer regression | 8 | 0 / 0 |
| Isolated migration assertions | 14 | 0 / 0 |

These final recorded runs contain **280 passing executions / 245 distinct test-or-check cases**: the browser command includes the same 35 integration tests. Public HTTPS smoke additionally passed two actual browser runs covering ten page checks and health 200. Lint, TypeScript checking, and production build all passed.

Initial unsuccessful runs exposed fixture conversion errors, a randomized foreign-ID check that could reuse its original ID, old Phase B support/guard assumptions, the old restart adapter's fixed port, and an overlapping development-server connection reset. Those fixtures were corrected; the final standalone integration and recovery runs above passed with no retries. Disposable QA databases, buckets, gateways, and owned worker processes were cleaned up. No live QA customer/account was added.

Run Next.js suites sequentially because Next's generated TypeScript configuration is shared by this checkout. From `C:\Data\ai-site\saas`:

```powershell
node tests/phase-c/migration.mjs
node tests/phase-c/run.mjs --suite integration --app-port 3247 --storage-port 9047
node tests/phase-c/run.mjs --suite browser --app-port 3246 --storage-port 9046
node tests/phase-c/run.mjs --suite shared
node tests/phase-c/run.mjs --suite focused
node tests/phase-c/run.mjs --suite phase-b
node tests/phase-c/run.mjs --suite restart --app-port 3248 --storage-port 9048
npm run test:unit
npm run lint
npm run typecheck
npm run build
node tests/phase-c/audit.mjs
```

Worker command is run from `C:\Data\ai-site\worker-agent`. The live gate's private pre-migration snapshot remains ignored; it contains the full machine-local mapping, while committed inventory evidence uses pseudonyms.

## Paid Operations

| Operation | Real operations |
| --- | ---: |
| AI Video inference | **0** |
| WaveSpeed LLM analysis | **0** |
| Outreach sends | **0** |
| Payment charges | **0** |

All financial acceptance used isolated fake/test providers and payments. Worker process acceptance used local transfers/rendering and fixture transcription/analysis. No live inference, Outreach, payment, grant, or refund was triggered.

## Data Mutation Summary

Controlled live changes: one forward migration, 14 billing accounts, 14 owner membership records, 14 aggregate wallet projections, 21 immutable workspace account links, and account/key-scope metadata on existing billing rows. The old 21 workspace projection rows were replaced by the exact account aggregates. No ledger row was inserted/deleted, and no economic delta changed.

Historical users, workspace membership/data, Products, reference bytes, Jobs, inputs, versions, quotes, payments, and Phase A/B evidence were preserved. SMTP credentials and private configuration were unchanged. PostgreSQL, object storage, Cloudflare tunnel, and the normal worker-agent were left running; only the owned SaaS process was stopped and restarted. Owned test workers/runners/dispatchers were temporary and stopped by fixture cleanup.

## Remaining Deferred Work

- **CLIPPER EDITING & VARIATIONS → next separate phase.**
- **OUTREACH SAAS → separate phase.**
- **PHASE 10 → not started.**
- Account merging/moving and self-service account membership administration remain outside this phase. Existing account permissions are explicit; normal customer APIs cannot move a workspace between accounts.
- Real paid-provider and payment certification was intentionally excluded. Authenticated browser financial acceptance used isolated fake providers; live deployment verification preserved all existing economic data.
