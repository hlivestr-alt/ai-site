# Phase 7 final report

Completed on 2026-09-30 in `C:\Data\ai-site\saas`. The customer token architecture and deterministic acceptance gates pass. Real Xendit sandbox acceptance remains pending on credentials. Phase 8 has not begun.

## Migration and database integrity

`migrations/0007_billing_tokens.sql` creates twelve tables:

| Table | Purpose |
|---|---|
| `workspace_wallets` | One zero-initialized, nonnegative BIGINT wallet projection per workspace |
| `token_ledger_entries` | Authoritative append-only available/reserved movements |
| `price_catalogs` | TEST/PRODUCTION operation catalog and active-version pointer |
| `price_versions` | Immutable customer pricing rules |
| `billing_quotes` | Immutable request/input/price/amount/expiry authorization |
| `job_billing` | One quote, reservation and settlement lifecycle per paid Job |
| `token_packages` | TEST/PRODUCTION top-up package identity and active pointer |
| `token_package_versions` | Immutable integer token/fiat/currency package terms |
| `payments` | Workspace-owned payment identity and normalized lifecycle |
| `payment_events` | Append-only safe normalized provider events and replay identity |
| `fake_payment_states` | Durable local provider truth, separate from merchant payment state |
| `billing_reconciliation_issues` | Stable support issues with safe job/payment/workspace references |

Migrations 0001–0006 are unchanged. All seven migration checksums pass. Fresh database bootstrap through 0007 and upgrade of the existing Phase 6 SaaS database both pass. Existing jobs are grandfathered `LEGACY`; newly admitted customer jobs are `PAID`; SYSTEM_TEST jobs are `DIAGNOSTIC`.

Database enforcement includes ledger/event append-only triggers; immutable quote, price and package versions; immutable catalog, payment and JobBilling identities; monotonic settlement references; scoped foreign keys; positive integer package/quote amounts; entry sign/cause checks; unique ledger operation identities; and nonnegative wallet checks. Deferred constraints prevent committing a new paid Job without its reservation or a PAID Payment without its purchase ledger reference.

The ledger's AFTER INSERT trigger locks and updates the wallet in the same transaction. A conflicting insert does not apply a second projection update. Direct wallet balance edits/deletion and nonzero initial balances are rejected.

## Wallet and ledger

Each workspace owns its tokens. New workspaces start with available `0`, reserved `0`; the migration also creates zero wallets for existing workspaces. The workspace service audits new wallet creation. No automatic production signup grant exists.

Token arithmetic uses TypeScript `bigint` and PostgreSQL BIGINT; API amounts are decimal strings. Fiat uses integer minor units and a three-letter currency code. No floating-point accounting is used.

| Ledger entry | Available delta | Reserved delta |
|---|---:|---:|
| PURCHASE | +amount | 0 |
| PROMOTIONAL_GRANT | +amount | 0 |
| RESERVE | -amount | +amount |
| CAPTURE | 0 | -amount |
| RELEASE | +amount | -amount |
| REFUND | +captured amount | 0 |
| ADMIN_ADJUSTMENT | signed amount | 0 |

Available and reserved balances derive from the sums of their ledger columns. Capture consumes the hold and does not subtract from available again. Stable workspace-scoped keys and unique per-job entry-type/per-payment purchase indexes prevent duplicate movements. Corrections append compensating entries.

Admission locks the workspace wallet with `FOR UPDATE`, rechecks authorization and idempotency, validates the quote and funds, and commits Job, JobAttempt, outbox, JobBilling and RESERVE together. Failure rolls back the entire operation. Locks are per workspace; there is no global billing lock. Product, membership and provider-policy admission reads use that transaction's connection, including under ten simultaneous fresh requests.

Trusted support CLI operations require an active operator identity, reason, stable key, explicit support flag and audit. They support promotional grants, documented signed adjustments and one full token refund of a captured Job. Workspace Admin has no arbitrary grant/adjustment customer endpoint.

## Pricing and quotes

Price and package identities separate TEST from PRODUCTION. Activating a new immutable version changes only the active pointer. Existing quotes and jobs retain the exact original version and amount. The operator catalog CLI accepts supplied configuration, validates immutable versions, activates pointers and audits the configuration hash; replay was verified.

Explicit local TEST fixtures are:

- AI Video QUALITY: 140 TEST tokens per second, quantity one. A five-second request costs 700.
- Clipper: 400 base + 100 per requested clip + 100 when captions are enabled. Two requested captioned clips cost 700.
- Top-up package: 10,000 TEST tokens for 10,000 IDR integer minor units.

These are acceptance fixtures, not commercial prices. No active production price or package was created; the final audit reports zero of each. Normal production admission requires explicitly configured active pricing. The current AI input remains QUALITY, 4–30 seconds, 720p policy, quantity one. Clipper charges the known requested maximum rather than repricing from uncertain final clip count. Provider cost remains separate and is not displayed to customers.

Quotes are durable and server-authoritative, without creating a Job. Default lifetime is 15 minutes, configurable only from 10–30 minutes. Hashes bind workspace, operation, normalized customer request, frozen validated execution inputs, price version, amount, quote identity and expiry. Product/source/reference/settings/policy changes or expiry require a new quote (409); foreign quote IDs return 404. Browser-provided prices are never authoritative.

The v1/v2 test passes: a still-valid v1 quote reserves its original 700 after v2 activation; a new quote uses v2's 800. A consumed quote cannot fund another Job. Matching replay of an existing Job returns that Job even after quote expiry or later Product changes; changed normalized input with the same key returns 409.

## Paid Job lifecycle

Normal customer AI Video and Clipper APIs require a quote and atomic reservation, including their fake execution paths. The fake backend does not grant free customer execution. Existing explicitly privileged diagnostic paths and SYSTEM_TEST remain separated as DIAGNOSTIC; billing mode cannot be changed or replayed across paid/diagnostic identities.

| Outcome | Accounting behavior |
|---|---|
| Admitted Job | One JobBilling and one RESERVE |
| Authoritative SUCCEEDED | One CAPTURE after a complete distinct READY artifact manifest from the current successful attempt and durable Content publication intent |
| Definitive FAILED | One RELEASE when no uncertain provider execution remains |
| Queued/pre-execution CANCELLED | One RELEASE |
| Running cancellation request | Retain reservation until authoritative outcome |
| RECONCILING / SUBMISSION_UNKNOWN | Retain reservation; no new submission, capture or release based on age |
| Retry/worker checkpoint/upload recovery | Reuse the same Job and reservation |
| Released Job later reports success | Record `LATE_SUCCESS_AFTER_RELEASE`; quarantine publication/approval eligibility/media access; never charge again |
| Support token refund | Append one positive available entry; CAPTURED → REFUNDED |

The dispatcher derives settlement work from durable JobBilling and Job state and runs it before Content publication. It can recover a missing safe settlement after restart. Queued cancellation also attempts settlement after its cancellation transaction commits.

Content publication, posters, review approval/rejection, variants, download and archive do not add charges. Rejected content remains a completed paid computation. Publication retries use the sealed Job artifacts independently of charging. The deterministic Clipper acceptance sealed two outputs under one 700-token parent charge; repeated publication, posters, review, variant, download and archive left the ledger at exactly RESERVE + CAPTURE.

## Payments and Xendit

The provider abstraction implements create, query, authenticate and parse, plus an optional refund capability. Package versions supply authoritative token amount, fiat amount and currency. Customer payment creation is Owner/Admin-only and reauthorized inside the transaction.

The local Payment is committed as CREATING before external creation, with a stable `topup_<payment UUID>` reference and one persisted creation claim. Matching request replay reuses its identity. An ambiguous create is held for reconciliation/support and never blindly repeated. Known external IDs can be queried; the deterministic fake provider can also recover its known identity after a lost response.

Normalized states are CREATING, PENDING, PAID, FAILED, EXPIRED and REFUNDED. A verified matching late PAID event may settle an expired/failed original Payment; stale pending/expiry cannot undo PAID/REFUNDED. The browser checkout return is informational and cannot credit tokens.

Webhook handling authenticates before parsing, bounds the raw body, and stores safe normalized fields and hashes rather than provider secrets or full sensitive objects. It resolves our stored Payment identity, locks that payment and then its workspace wallet, and verifies external/reference/business identities, amount, currency and package mapping. PAID, PURCHASE, wallet projection, event and audits commit together. Invalid authenticity is rejected; authentic but mismatched/unknown events create support issues without credit. Duplicate/conflicting identities cannot double-credit. Provider query reconciliation enters the same idempotent transition service as webhooks.

FakePaymentProvider requires explicit local TEST flags and a separate long webhook secret. Its durable truth supports pending, paid, failed, expired, late/duplicate callbacks and refund simulation. UI is labeled SIMULATION / TEST. The purchase path uses the same processor as Xendit.

The Xendit adapter follows current official documentation checked 2026-09-30: [Payment Sessions](https://docs.xendit.co/docs/payment-sessions-overview), [one-time payment flow](https://docs.xendit.co/docs/payment-1), [create](https://docs.xendit.co/apidocs/create-session), [query](https://docs.xendit.co/apidocs/get-session), [session callbacks](https://docs.xendit.co/apidocs/webhook-notification-sent-defined-webhook-url-updates-payment-session), [webhook verification](https://docs.xendit.co/docs/handling-webhooks), [test/live keys](https://docs.xendit.co/docs/api-keys), [refund request](https://docs.xendit.co/apidocs/refund-payment-request) and [refund callbacks](https://docs.xendit.co/apidocs/refund-webhook-notification).

It uses PAY / PAYMENT_LINK Sessions with AUTOMATIC capture, HTTP Basic authentication, 30-minute expiry, authenticated GET by session ID and constant-time `x-callback-token` verification. Stable event identity excludes delivery timestamps. Phase 7 intentionally supports IDR integer amounts only. Test mode, development-key prefix and sandbox hosted-link guards prevent production payment use; the key-prefix check is our defensive policy, not a claimed documented Xendit contract. No undocumented create idempotency header or reference lookup is assumed. Mocked official-shaped transport tests pass.

Token refund and fiat refund are separate. Authenticated real refund callbacks resolve the original confirmed provider request and record support issues; a full confirmed refund may mark REFUNDED. Fake fiat-refund simulation likewise flags support. Neither automatically claws back tokens or makes a wallet negative. Optional sandbox refund transport exists; no broad customer fiat-refund engine or automatic retry was added. Chargeback/reversal policy remains support investigation and an explicitly reasoned correction, not automatic negative balances.

Xendit sandbox credentials configured: **NO**. Real sandbox payments attempted: **0**. Production payments: **0**.

**REAL XENDIT SANDBOX ACCEPTANCE BLOCKED — XENDIT SANDBOX CREDENTIAL REQUIRED**

## Billing UI and permissions

Billing & Tokens is operational. It shows real available/reserved/purchased/spent values, TEST packages and checkout status where authorized, transaction history, payment history and recent Job usage. Home shows the real wallet. AI Video, Clipper and generic Job detail show token cost and billing state, including pending settlement. Forms refresh quotes when inputs change, discard stale responses, display available funds and disable unquoted/unaffordable submission with a Buy Tokens link. Server admission still enforces funds under races.

| Role | Wallet/token history/usage | Paid Job submission | Packages/top-up/payment history |
|---|---|---|---|
| Owner | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes |
| Editor | Yes | Yes | No |
| Viewer | Read-only | No | No |

Workspace active membership and roles are checked server-side. Mutation transactions hold membership/workspace share locks against concurrent revocation. Brand A/B ID substitution is denied for wallet, ledger, quote, payment and billing APIs. Only safe customer fields are returned. Ledger and payment history use bounded 50-row pages ordered by creation time and ID; cursors preserve PostgreSQL microseconds. The 52-row tied-timestamp tests return 50 + 2 unique rows without omission or duplication.

Audits cover WALLET_CREATED, TOKENS_PURCHASED, TOKENS_GRANTED, JOB_TOKENS_RESERVED, JOB_TOKENS_CAPTURED, JOB_TOKENS_RELEASED, TOKENS_REFUNDED, PAYMENT_CREATED, PAYMENT_CONFIRMED and documented adjustments/catalog activation. Provider credentials and webhook tokens are never audit metadata.

## Concurrency, rollback and reconciliation

| Hard acceptance gate | Verified result |
|---|---|
| Two distinct concurrent 700-token requests with 1,000 available | One 201, one 402; available 300, reserved 700; no negative balance |
| Ten simultaneous fresh submissions of the same paid request | One 201, nine 200; one Job, one JobBilling, one RESERVE |
| Ten existing matching Job replays | Original Job returned; reservation count remains one |
| Ten concurrent authentic PAID callbacks | One PURCHASE and one 10,000-token credit |
| Concurrent/repeated terminal settlement | One CAPTURE or RELEASE; reservation not debited twice |
| Forced reservation transaction failure | No Job, orphan reservation or wallet change survives |
| Forced purchase insert failure after attempted PAID transition | Merchant Payment/credit roll back; authoritative query safely retries |
| Price/input/expiry mismatch | Rejected without creating work or reserving tokens |

`npm run billing:reconcile` reports wallet versus ledger, outstanding reservations versus JobBilling, terminal omissions, capture without success, purchase/payment inconsistencies, package mismatches and released late success. `--repair-safe` uses only validated settlement and authoritative provider queries. It never rewrites ledger history/projections, releases by age, re-submits unknown execution or repeats ambiguous payment creation. Controlled projection drift was detected and was not automatically rewritten; the test fixture restored it explicitly.

Final accounting audit: wallet projection mismatches **0**; reserved projection mismatches **0**; active production prices **0**; active production packages **0**. Main and isolated test databases match all seven migration checksums.

## Chrome and restart acceptance

Real Chrome acceptance ran against isolated test database/storage:

| Browser result | Value |
|---|---:|
| Initial wallet | 0 available / 0 reserved |
| TEST package purchased | 10,000 tokens |
| Normal paid fake AI Video captured | 700 tokens |
| Definitively failed paid Job released | 700 tokens |
| Final wallet | 9,300 available / 0 reserved |
| Browser close/reopen | Passed |
| Separate Content publication | Passed; no extra charge |
| Brand A/B isolation and Viewer denial | Passed |

Success Job: `06e95219-9ca4-41c1-a880-c5803ae93655`. Failure Job: `2b0fe68e-b3c5-4242-addd-c869a41f4d4a`. The rendered Billing page was visually checked.

Billing restart acceptance restarted actual app, dispatcher and payment reconciler processes with a pending payment, a reserved Job and a running Job. Result: 20,000 purchased; 1,400 captured; 18,600 available; 0 reserved; two provider submissions for two Jobs; two captures; pending Payment credited once. State persisted without duplicate financial entries.

Legacy restart acceptance also passed: worker lease loss/retry and stale-fence rejection; one AI provider submission/artifact across restart; and controlled Content publication failure followed by app/dispatcher restart and ten publication replays producing one Content/version without regeneration.

## Validation

| Check | Result |
|---|---|
| TypeScript unit suite | 14 passed |
| Private worker Python unit suite | 10 passed; no new transcription/GPU run |
| Full Playwright integration + Chrome suite | 24 passed: 19 integration + 5 browser |
| Affected billing/content suite after transaction-connection fix | 10 passed, including ten fresh submissions |
| Latest billing/edge/Chrome suite after payment-history pagination | 8 passed |
| Billing process restart acceptance | Passed |
| Legacy Job, AI Video and Content restart scripts | All passed |
| Fresh migrations 0001 → 0007 | Passed |
| Existing Phase 6 database upgrade | Passed |
| Old migration scope and all seven checksum checks | Passed |
| TEST catalog CLI replay | Passed |
| Final lint | Passed |
| Final typecheck | Passed |
| Production build | Passed |
| `git diff --check` | Passed |
| Changed source paths outside SaaS | 0 |

The full suite preceded the transaction-connection fix; affected cases were rerun successfully after it. The latest pagination change passed typecheck/build and all eight affected billing/edge/Chrome cases. These are distinct runs, not a claimed combined test total.

Local ignored evidence is in `saas/data/phase7`: `browser-acceptance.json`, `billing-chrome.png`, `restart-acceptance.json`, `accounting-audit.json` and `native-audit.json`. Logs include `phase7-final-suite.log`, `phase7-final-billing-regression.log`, `phase7-payment-pagination-tests.log`, `phase7-final-restart.log`, the three legacy restart logs and `phase7-build.log`. These files contain local acceptance evidence and are not committed artifacts.

Reproduction commands from the SaaS directory: `npm run test:unit`, `npm run test:browser`, `npm run test:billing-restart`, `npm run test:restart`, `npm run test:video-restart`, `npm run test:content-restart`, `npm run test:schema-bootstrap`, `npm run lint`, `npm run typecheck`, `npm run build`. Tests require explicit isolated TEST database/storage and fake-provider configuration. Test fixtures explicitly fund wallets and obtain real quotes.

## Phase 8 handoff

The reusable contracts are server quote creation/validation, atomic paid Job admission/reservation, `settleJob`/`settlementBatch` capture/release, immutable JobBilling and ledger references, and provider-neutral payment creation/query/event processing. Each future paid workflow child must own a stable workspace/operation/request identity, a valid frozen-input quote and its own JobBilling. Parent workflows must never charge again for billed children.

Low balance returns 402 and must stop admission of new paid children before Job/attempt/outbox creation. Already completed or admitted children retain their state. Refresh stale/expired quotes after 409; resume an intended child using its stable identity rather than creating duplicate work. Retry of an admitted Job reuses its existing reservation. Unknown/reconciling executions retain funds until authoritative settlement. Content/review state remains independent of charging.

Production commercial prices/packages require supplied configuration. Real Xendit sandbox acceptance requires credentials, public authenticated webhook delivery and an HTTPS return URL, followed by exactly one controlled sandbox top-up. BytePlus/OpenAI real acceptance remains separate. No Workflow Engine, subscriptions, automatic chaining, customer Outreach billing, campaigns, publishing, GMV/ROI or advanced analytics were implemented.

## External status and safety

| System / activity | Phase 7 result |
|---|---|
| BytePlus credential configured | NO |
| OpenAI analyzer credential configured | NO |
| Internal AI Site changed | NO |
| H3 Bridge changed | NO |
| Creative Studio changed | NO |
| Native Clipper changed | NO; 2,572 baseline files compared, 0 changed, 0 missing |
| Native Clipper DB/schema changed | NO |
| Outreach changed | NO |
| Native Outreach DB changed | NO |
| Real Seedance generations | 0 |
| Real OpenAI analyzer calls | 0 |
| Native production Clipper jobs | 0 |
| Outreach campaigns | 0 |
| Creator messages | 0 |
| Production payments | 0 |
| Real Xendit sandbox payment attempts | 0 |

Only SaaS source, fixtures, migration and Phase 7 documentation changed. Work stops after Phase 7.
