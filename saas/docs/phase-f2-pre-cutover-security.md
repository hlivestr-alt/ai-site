# Phase F.2 — Pre-Cutover Security Closure

## Outcome

**PASS — READY FOR CALLBACK CUTOVER.** The exposed native database credential is rotated and rejected, affected services are healthy, the encrypted internal-account inventory is resolved, private exclusions are configured and tested, and the shared router passes isolated acceptance. The manual provider contract review remains **PENDING**. This result authorizes no provider setting change, live seller authorization or message.

Completed 2026-10-08. Native configuration implementation: `ab9ecf1a47529be47ddd845c9e7523465830c131`. The documentation/evidence commit is identified in the final task response. Existing SaaS/native router implementation remains `eb5b4264454b884815a387dcf197244ee2c0d8cf` / `893c62e8bd8013d1bd656f232c86e8fb4caf5ce8`; prior documentation and evidence remain unchanged.

## Legacy Credential Rotation

**Legacy credential incident: ROTATED / OLD CREDENTIAL REVOKED.** Only the affected native PostgreSQL principal's password changed. A fresh random private secret was written directly to the native private environment and the old AI Site's private database reference. A SCRAM-SHA-256 verifier was assigned to the same principal; plaintext password was not included in the SQL statement. PostgreSQL statement logging was already disabled.

Native Compose now requires a private bootstrap/database password instead of embedding the retired default. Its tracked example contains placeholders. Current private configuration resolves consistently for API, workers, PostgreSQL initialization and the inactive diagnostics service. App secrets, seller access/refresh material, encryption, SMTP, SaaS database and router/handoff keys were not rotated.

The same role and table permissions are preserved. The existing role is a superuser; this task does not claim a least-privilege redesign. No unrelated database principal was changed.

## Affected Services

The consumer audit inspected all running Docker environments, Compose resolution, local project processes, private configuration references and PostgreSQL activity. It also found an inactive archived native checkout and CI fixture references, distinguished from active consumers.

| Consumer | Action | Final result |
| --- | --- | --- |
| Native API | Private database configuration updated; same image recreated | Healthy; new connection works |
| Discovery worker | Same image recreated with replacement credential | Fresh heartbeat; DB readable |
| Outbound worker | Same image recreated with replacement credential | Fresh heartbeat; idle queue; DB readable |
| History worker | Same image recreated with replacement credential | Fresh heartbeat; DB readable |
| Native PostgreSQL | Password verifier changed; future private bootstrap source updated | Healthy; original container retained |
| Old internal AI Site | Private database reference updated; actual read-only overview adapter checked | Connected; application remains inactive |
| Marketplace diagnostic profile | Shared private Compose database reference updated | Not started |

Native application images were pinned to their exact pre-rotation IDs. Verification detected older runtime overrides absent from current Compose defaults in outbound/history; their original values were recovered by private baseline-hash comparison and restored. Final verification shows **DATABASE_URL is the only changed pre-existing environment key** in each affected application. No unrelated pending native source was built or deployed.

The ignored `.next-tests/phase-f2/rotation.override.yml` retains exact image pins and the necessary original worker overrides. It contains the private database reference and must remain ignored; preserve it when repeating this deployment. Do not replace those worker values with unrelated Compose defaults. SaaS was restarted once to load the private exclusion list, with its existing production build.

## Old Credential Rejection Proof

Fresh TCP authentication using the retired credential fails with PostgreSQL **INVALID_PASSWORD (28P01)**. Fresh authentication using the replacement succeeds. Neither value nor a connection string is included in evidence. All remaining affected-role application sessions started after rotation; no pre-rotation session remains.

Evidence: [credential-rotation.json](phase-f2-evidence/credential-rotation.json), [database-sessions.json](phase-f2-evidence/database-sessions.json).

## Native Service Health

Native API, native UI and local/remote SaaS health return 200. Each of the API and three worker containers independently establishes a new database connection, reads campaigns/deliveries/outbox/selection/grants, and decrypts the selected seller's existing encrypted token pair inside native services without returning it. All worker heartbeats are fresh and RUNNING.

| Native service | Baseline container | Final container |
| --- | --- | --- |
| API | `c0bc60e04df0` | `0df0642c7021` |
| Discovery | `725d2516ebc0` | `9a82f0c745ab` |
| Outbound | `9efc156b1fff` | `b398b6f22046` |
| History | `232f6401afe6` | `22f24aa5b1b2` |
| PostgreSQL | `00ac55d113bc` | `00ac55d113bc` |

The outbound queue had zero waiting, active, delayed, prioritized or paused jobs before rotation. No campaign was QUEUED, RUNNING, FROZEN or PAUSE_REQUESTED, and no selected healthy seller token was due for refresh in the following hour. Restarting workers did not resume a campaign or submit a message. The old AI Site's existing read-only integration returns all 46 campaigns without starting that application or calling mutating campaign-list endpoints.

Evidence: [native-health.json](phase-f2-evidence/native-health.json), [old-site-read.json](phase-f2-evidence/old-site-read.json).

## Internal Account Inventory

Privately inspected **801 total native grant rows**, including the **652 encrypted TikTok grants** at issue. One encrypted grant maps to the existing READ_ONLY shop and its current native usage/selection. That canonical external shop identity is confirmed internal and covered privately. The other **651 encrypted grants** have no Shop record.

All 651 orphan encrypted grants authenticate under the public test-only key declared in the tracked refresh integration suite and decrypt to that suite's exact synthetic token literals. No token, raw identity, cipher or exclusion hash is published. This is cryptographic fixture evidence, not an inference from record age. No provider call, refresh, authorization or deletion was used.

## Grant Provenance Classification

Classification of the 652 encrypted TikTok grant records:

| Classification | Rows | Supporting evidence |
| --- | ---: | --- |
| ACTIVE_INTERNAL | 1 | Existing READ_ONLY Shop, canonical external identity, encrypted grant, native usage and selection |
| HISTORICAL_INTERNAL | 0 | None additionally established |
| TEST_FIXTURE | 0 | No current fixture shop needs separate treatment |
| OBSOLETE_FIXTURE | 651 | Authenticated exact synthetic tokens; missing fixture Shop; no campaign/delivery/selection/business references |
| UNRESOLVED | 0 | All encrypted grants classified |

The source fixture is `C:\Data\TikTok Outreach\apps\api\src\integrations\tiktok-refresh.integration.test.ts`. It creates temporary READ_ONLY shops and synthetic encrypted grants, then deletes shops during cleanup. `IntegrationConnection.shopId` has no Shop foreign key, so grants remain after cleanup. Ten proven fixture grants retain only SEARCH_CREATORS/read-lease throttle references; those diagnostic rows do not establish seller ownership or campaign use. All historical rows remain intact.

The other **149 rows have no access/refresh ciphertext, seller identity, authorization timestamp, existing Shop or business reference**, and have REFRESH_OUTCOME_UNCERTAIN status. They are separately recorded as non-authorizing records, not counted as additional provider identities or cryptographically proven fixture identities. Native authorization creates a Shop and records authorization metadata; uncertain refresh removes token material without removing that metadata. These rows supply neither an active native sender nor a canonical identity to fingerprint. Their former identity is not guessed.

Evidence: [inventory.json](phase-f2-evidence/inventory.json). Per-row identifiers and analysis remain private.

## Exclusion Fingerprint Coverage

The single confirmed internal canonical external shop ID was hashed using exactly SHA-256 of UTF-8 `JSON.stringify({provider:'TIKTOK_SHOP',account:externalShopId})`. Only its hash was written to ignored private SaaS exclusion configuration. The list and raw identity are absent from Git/evidence.

Isolated acceptance uses the privately confirmed identity and verifies that it is rejected, an unrelated controlled QA seller is accepted, shared developer-app configuration cannot bypass exclusion, and browser/API identity/status/override fields cannot activate the account. Provider account uniqueness across Workspaces remains enforced. No native seller credential was imported into a SaaS account/store.

`OUTREACH_TIKTOK_CONTRACT_REVIEWED=0` and `OUTREACH_REAL_SEND_ENABLED=0` remain explicit. Live provider configuration loads successfully and real activation remains blocked by contract review. Private exclusion coverage for the existing native authorization identities is complete enough for safe routing; no empty or guessed list opens the guard.

Evidence: [exclusion-configuration.json](phase-f2-evidence/exclusion-configuration.json), [internal-exclusion.json](phase-f2-evidence/internal-exclusion.json), [direct-api-exclusion.json](phase-f2-evidence/direct-api-exclusion.json), [live-provider-guards.json](phase-f2-evidence/live-provider-guards.json).

## Remaining Unresolved Grants

**Zero unresolved encrypted grants or possible active internal seller identities remain in the reviewed native inventory.** All 651 previously ambiguous encrypted orphan grants are proven obsolete fixtures. The additional 149 tokenless orphan records cannot currently authenticate or supply a native selected shop and are not promoted into invented seller identities. They are preserved, with their separate metadata category documented above.

If a later private import, restored Shop or newly discovered native authorization establishes another internal canonical identity, update the private inventory/exclusion list before enabling customer authorization. This closure does not validate unknown future grants or assume provider eligibility.

## Partner Center Review Checklist

Prepared [phase-f2-partner-center-checklist.md](phase-f2-partner-center-checklist.md) with all 14 requested operator checks, each containing Where to look and Expected / acceptable result. Every box remains unchecked. Actual app type, markets, external-seller eligibility, permissions, namespace, quotas and approval must be established by the operator against the existing app. Documentation/fixture success does not self-attest those terms.

**Contract-review flag: 0 / false.** No provider app, callback, permission, webhook, market or secret setting was changed.

## OAuth Router Regression

**247 tests pass:** 205 native unit tests, 25 affected refresh/identity integration tests, 10 shared-router acceptance tests, four Chrome/Edge desktop/mobile browser tests, and three exclusion/API-manipulation tests. No failure or skip remains in the final acceptance runs. Native API fixture build and exclusion-test lint pass.

Fixtures prove SaaS state completes only into SaaS, Native state completes only through the authenticated private native flow, and replay, expiry, wrong browser/session, tampered state and forged handoff are rejected. Runtime/browser marker checks detect zero code/state leaks. Provider operations are replaced by isolated fixtures; unexpected external browser requests are blocked. No real seller grant or token exchange is involved.

The copied harness uses owned temporary databases/buckets/processes and separate F.2 evidence paths, preserving all A–F.1 evidence. Owned resources and mail files are removed afterward. No fixture listener remains on ports 3273, 3351, 4351 or 9073. Initial F.2 harness setup needed a Windows import-path correction and an unanchored test-title filter; final runs are green and no real provider request occurred.

Evidence: [test-summary.json](phase-f2-evidence/test-summary.json), [router-run.json](phase-f2-evidence/router-run.json), [router-browser-run.json](phase-f2-evidence/router-browser-run.json), [provider-run.json](phase-f2-evidence/provider-run.json).

## Secret Audit

**PASS for current operational exposure and new material. Zero active private-value leaks detected.** Private comparisons cover current credential references, tracked Git, staged/history changes, new evidence, fixture/runtime output, native API/worker/UI/PostgreSQL logs, local/remote browser responses, SaaS client/server production bundles and native client bundles. The private exclusion configuration remains ignored. No secret or complete authorization/recovery link is committed.

Historical transcript exposure cannot be erased retroactively. Retired legacy references remain in historical Git, inactive archives and the CI fixture definition; they cannot authenticate to the live native database. The original running PostgreSQL container still contains its retired bootstrap value in local container metadata. Its existing data volume does not use that environment value for runtime authentication; the live role verifier rejects it and the private source for a future recreation contains the replacement. PostgreSQL was deliberately not restarted to rewrite that metadata. These facts are reported as **ROTATED / OLD CREDENTIAL REVOKED**, never as “never exposed.”

Evidence: [secret-audit.json](phase-f2-evidence/secret-audit.json).

## Data Preservation

All **919 pre-existing phase evidence files** are preserved byte-for-byte. The original **258 unaffected native tracked files**, including the native working changes present before this task, remain unchanged. Only native Compose/example credential defaults changed in tracked native configuration.

All **86 SaaS and 42 native table schemas** remain intact, with no schema migration or row-count decrease. SaaS customer, wallet, ledger, job/content and live Outreach data fingerprints are unchanged; only existing worker/service heartbeats changed. Native **46 campaigns, 4,212 deliveries and 4,212 outbox records** and their history fingerprints remain unchanged. All **801 grants' critical encrypted material/identity/scopes/version/status fields**, shop identities/ciphers and selection are unchanged. Nothing was deleted to resolve inventory.

The already RUNNING native Creator Database sync predates the baseline and continued its ordinary read/sync work; resulting creator/page/read-diagnostic metadata growth is distinguished from campaign or credential changes. The discovery image/source is unchanged. All **11 unaffected container IDs**, including PostgreSQL, Redis, native UI, SaaS PostgreSQL/storage/gateway and unrelated services, are preserved. Cloudflare tunnel and worker-agent were not touched.

Evidence: [preservation.json](phase-f2-evidence/preservation.json), [native-health.json](phase-f2-evidence/native-health.json).

## Real Operations

| Operation initiated by this task | Count |
| --- | ---: |
| Real TikTok seller authorizations | 0 |
| Real TikTok token exchanges/refreshes | 0 |
| Real Outreach messages/canaries | 0 |
| Real AI/LLM/WaveSpeed calls | 0 |
| Real payment charges | 0 |
| Real email sends | 0 |
| Partner Center changes | 0 |

`OUTREACH_REAL_SEND_ENABLED=0` remains unchanged. Existing native read/sync background work was preserved. No campaign was resumed, sender identity changed, Phase 10 started or paid provider invoked.

## Callback Cutover Readiness

**READY FOR CALLBACK CUTOVER**, under the requested technical pre-cutover criteria: old credential revoked, new credential working, affected services healthy, router/logging acceptance green, no new secret leaks, confirmed native identity covered and manual review sheet prepared.

The provider contract flag remains false pending human review, so customer activation stays closed. Partner Center still uses its existing single Redirect URL; this task does not change it or initiate live certification. SaaS/native share the existing developer app while retaining separate seller credential stores and ownership.

## Remaining Manual Steps

1. Complete the existing-app checklist and report the observed non-secret results. Resolve any unsupported app/market/permission/namespace/quota contract before enabling the contract flag.
2. Only in a later explicitly authorized cutover, follow the preserved F.1 pause/expiry/callback/rollback procedure and manually change the single Redirect URL to `https://ai-test.proyaofficial.com/api/outreach/tiktok/callback`. Do not change unrelated provider settings.
3. A subsequent authorized live certification must use a different independently controlled QA seller, preserving the excluded internal sender. Keep real sending at zero. Live authorization, messages, canaries and Phase 10 are outside F.2.

No commit was pushed automatically. Private rotation and exclusion files remain ignored.
