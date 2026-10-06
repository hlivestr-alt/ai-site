# Stabilization Phase B — Customer Onboarding, Workspaces & Product UX

Date: 2026-10-06. Repository baseline: `db0bd7b`. Phase A implementation `ef98f0b95218f8e1975c8cf9b64ecfc850b250d2` and report commit `3d5e7de` remain present.

**Application implementation: PASS. Overall acceptance: PASS.** AUTH-001 is certified with real remote SMTP delivery, operator-confirmed mailbox receipt, verification/resend, password recovery, one-use links, and session revocation. All Phase B items now pass application and applicable browser acceptance. Final SMTP certification: 2026-10-06.

## Item Status

### AUTH-001 — PASS

Initial root cause: registration committed the pending user and token before encrypting/enqueuing verification mail. The initial public deployment lacked a mail encryption key and SMTP credentials. Retrying an existing pending email produced a uniqueness error.

Implementation: account creation, hashed single-use token, encrypted delivery task, and audit now commit atomically. A preparation failure rolls back the entire transaction. Concurrent normalized-email retries create one user, retain its original password/profile, supersede old tokens, and enqueue a fresh link. Active-email submissions return the same generic response. Verification, resend, and password recovery serialize on the user; delivery runs after the response, with the existing durable dispatcher/retry queue as recovery. Delivery tasks reference their expiring auth token, so superseded/expired links are skipped. No plaintext auth token is stored in Postgres.

Files: `src/lib/auth.ts`, `mail-core.ts`, `auth-mail.ts`, auth register/resend/forgot routes, `migrations/0011_customer_onboarding.sql`. Final SMTP certification also fixes token serialization in `src/components/auth-form.tsx`, `src/app/verify/page.tsx`, `src/app/reset-password/page.tsx`, and `src/proxy.ts`, with five focused unit cases in `tests/unit/auth-link-privacy.test.ts`.

Original application evidence remains preserved: [auth-application.json](stabilization-phase-b-evidence/auth-application.json), Phase B atomic rollback/provider-failure probe, concurrent signup/active-email/single-use tests, and foundation recovery/session-revocation regression. The original remote run withheld registration because SMTP was absent. Final real SMTP evidence: [auth-remote-smtp.json](stabilization-phase-b-smtp-evidence/auth-remote-smtp.json), [remote-auth-privacy.json](stabilization-phase-b-smtp-evidence/remote-auth-privacy.json), and [secret-audit.json](stabilization-phase-b-smtp-evidence/secret-audit.json). Two new controlled accounts registered remotely; all four messages arrived; verification, resend, reset, replay rejection, old-password rejection, and session revocation passed. The external SMTP blocker is resolved.

### AUTH-002 — PASS

Root cause: register/forgot copy unconditionally described a local mailbox, and page props checked only `APP_ENV=local` despite a public HTTPS base URL.

Implementation: normal verification/recovery language, a customer resend page/link, and mailbox controls only for actual loopback local/test deployment. Files: `src/components/auth-form.tsx`, `src/lib/mail.ts`, login/register/verify/forgot/reset/resend pages. Evidence: local/public guard assertions in the auth probe; remote Chrome and Edge checked register, forgot, reset, and resend pages without local wording or mailbox links. Final AUTH-001 certification also confirms real remote mail delivery and clean public auth copy.

### WORKSPACE-001 — PASS

Gap: an existing customer had no creation control in the shell. Implementation: **Create workspace** in the selector area accepts a name, calls existing creation/membership APIs, selects the new workspace, and refreshes server data. Creator membership is `OWNER / ACTIVE`; the existing schema trigger creates an empty workspace wallet. Files: `src/components/shell.tsx`. Evidence: [workspace-chrome.json](stabilization-phase-b-evidence/workspace-chrome.json), [workspace-msedge.json](stabilization-phase-b-evidence/workspace-msedge.json), and remote customer creation. Limitation: wallets remain per workspace until Phase C; creation grants/transfers no Tokens.

### WORKSPACE-002 — PASS

Root cause: successful selection left the client's `switching` flag true; router refresh preserves client state. Implementation: clear the request flag in `finally`, track the navigation transition, show failures, and key tenant page children by the active workspace. Server session selection and refreshed workspace props remain authoritative. Files: `src/components/shell.tsx`. Evidence: both actual browsers perform A → B → A → B without reload or hard navigation, verify session/selector and Product data after each switch, deny foreign workspace IDs, and check AI Video/Clipper/Content pages. Remote browsers repeat switching successfully. Remaining limitation: switching returns to Home, preserving the existing navigation convention.

### PRODUCT-001 — PASS

Gap: catalogue cards displayed initials, with no durable cover selection. Implementation: workspace/Product-scoped cover pointer and deterministic current-image fallback; catalogue renders private thumbnails; editor indicates COVER and provides **Set as cover**. Version identity refreshes preview URLs after replacement. Removed selected covers fall back to Front, another current image, then the initial. Files: `src/lib/products.ts`, `assets.ts`, `src/components/product-references.tsx`, `protected-media.tsx`, catalogue/editor pages, cover route, migration `0012_product_reference_slots.sql`. Evidence: lineage/API test; both browser upload/cover journeys; remote cover selection, v2 replacement, loaded catalogue image, and fresh editor badge. Limitation: covers use image references; videos remain previewable references.

### PRODUCT-002 — PASS

Gap: Source, permission notes, and a required rights confirmation interrupted normal uploads. Implementation: remove those fields from customer reference forms; derive `CUSTOMER_UPLOAD`, authenticated uploader/workspace, creation timestamp, and version internally. `permission_confirmed_at` remains null when the customer did not attest; explicit legacy rights declarations are still validated. Workspace/role authorization is unchanged. Files: `src/lib/media-validation.ts`, `assets.ts`, `src/components/product-wizard.tsx`, `product-references.tsx`. Evidence: provenance unit/API assertions, eight-card browser forms without Source/checkboxes, and remote Product creation. Limitation: accuracy controls remain useful optional Product instructions; they are not a permission checklist.

### PRODUCT-003 — PASS

Gap: a purpose dropdown hid the reference areas. Implementation: eight visible responsive cards with upload/replace, preview, cover selection where applicable, and remove actions. Files: `src/lib/reference-slots.ts`, reference component, wizard, CSS, and migration `0012`. Evidence: both browsers assert eight cards and no purpose dropdown; local/remote screenshots at 390 × 844, 768 × 1024, and 1440 × 1000 show no horizontal overflow. Limitation: one current reference per card; legacy media remains historical. Eighth-role decision is documented below.

### PRODUCT-004 — PASS

Gap: fetch PUT provided no upload transfer progress and one busy flag blocked all references. Implementation: independent card state; signed private PUT through XMLHttpRequest; percentage only from computable `upload.onprogress` loaded/total bytes; Preparing → Uploading → Processing / Validating → Ready; safe failure and Retry. Retry discovers pending state after a lost intent response and retires only failed/uncertain pending versions. A lost finalization response resolves the existing READY version without creating a duplicate version. Files: reference component, scoped abort route, `src/lib/assets.ts`, Product detail API/editor pending-state metadata. Evidence: throttled real Chrome/Edge transfers record intermediate percentages, concurrent Front/Back uploads, interrupted PUT, lost intent response, and lost finalize response recovery; remote signed uploads finalize successfully. Limitation: validation has a stage label rather than a percentage; files are retained under Phase A cleanup policy.

### PRODUCT-005 — PASS

Root cause: every normal upload could create another READY asset of the same purpose. Implementation: Product-locked current slot selection; matching purpose/type automatically appends a version to the current asset; pending-slot uniqueness prevents overlapping intents for one slot. Only validated READY finalization advances the slot pointer. A media/purpose change can create a new asset and advance the same slot. Current Product snapshots select slot pointers; historical jobs use frozen immutable versions. Selected covers follow replacements. Files: `assets.ts`, `products.ts`, reference slots, migration `0012`. Evidence: [product-lineage.json](stabilization-phase-b-evidence/product-lineage.json): v1 job snapshot and stored bytes/hash remain valid; future job freezes v2; one current slot. Remote covered Front replacement becomes v2. Limitation: failed upload attempts can consume version numbers; immutable history is retained.

### PRODUCT-006 — PASS

Gap: archive existed without a restore action. Implementation: existing Active/Archived filters plus scoped **Restore product**, transitioning the same Product from ARCHIVED to ACTIVE without changing its information/rules/reference/cover pointers. Files: `src/lib/products.ts`, restore route, `src/components/product-actions.tsx`. Evidence: API identity/pointer equality after restore, local and remote archive/filter/restore journeys in both browsers. Limitation: restoring a conflicting active SKU is refused with a customer-safe message until the conflicting Product is corrected.

### AI-VIDEO-001 — PASS

Gap: the index always rendered the creation page. Implementation: server queries the latest current-workspace AI Video job in canonical active states and redirects to its progress page; terminal jobs are excluded. Files: `src/lib/job-core.ts`, `ai-video.ts`, `src/app/ai-videos/page.tsx`. Evidence: fake-provider tests cover all four states, newest selection, internal navigation, refresh, fresh authenticated tab, workspace switching, and terminal-only creation fallback. Remote limitation: active-generation scenarios were tested only in the isolated fake-provider environment; no real remote generation was submitted.

### BILLING-UX-001 — PASS

Gap: affordability feedback was small; the shared disabled-button style used a wait cursor and retained the primary appearance. Implementation: prominent **Required / Available Tokens** from the server quote, insufficient notice, grey native disabled buttons with `not-allowed` cursor, and **Refresh balance** in both forms. Quotes are bound to workspace/operation/request identity. Billing calculations and wallet ownership remain server-side and unchanged. Files: `src/components/token-quote.tsx`, `src/app/globals.css`; both existing creation forms consume this shared hook/view. Evidence: [token-ux.json](stabilization-phase-b-evidence/token-ux.json): both actions disabled at zero, cursor correct, refreshing funded test balance enables action, stale quote rejected with 402 and no admitted job. Remote limitation: paid submissions were not tested.

## Signup / Email Status

**APPLICATION FLOW: PASS. REAL REMOTE SMTP DELIVERY: PASS.** Certification ran against `https://ai-test.proyaofficial.com` using two unique aliases of the operator-controlled QA mailbox. The operator manually confirmed receipt of two initial verification emails, one resend verification email, and one password recovery email. All four matching SMTP delivery tasks are `SENT`. No inbox, webmail, IMAP, or mailbox credentials were accessed.

The operator configured SMTP before this certification. SMTP credentials, sender configuration, and the existing mail encryption key were left unchanged. The original Phase B evidence of missing SMTP remains historical evidence; the external dependency is now resolved. The public deployment used real SMTP, with development-file/fake delivery disabled.

| Final acceptance check | Result and evidence |
|---|---|
| New remote account registration | PASS; two new accounts returned 201 and entered pending verification |
| Initial verification email delivery | PASS; two operator-confirmed receipts and two `SENT` tasks |
| Verification activates account | PASS; operator activation independently confirmed by ACTIVE status, matching consumed token, and `EMAIL_VERIFIED` audit event |
| Login after verification | PASS; login and authenticated session returned 200 |
| Initial verification link is one-use | PASS; replay returned 400 |
| Resend delivers a fresh valid email | PASS; fresh SMTP task, operator-confirmed receipt, and Edge activation returned 200 |
| Superseded verification link is invalid | PASS; old link returned 400 while the account was still pending |
| Forgot-password email delivery | PASS; operator-confirmed receipt and `SENT` task |
| Password reset succeeds once | PASS; Chrome reset returned 200, replay returned 400 |
| Old password no longer works | PASS; old password returned 401; new password login returned 200 |
| Existing sessions are revoked | PASS; both captured old sessions returned 401 and no unrevoked account session remained before the new login |
| Customer-facing mailbox wording | PASS; checked register, verify, resend, forgot, and reset pages contain no local mailbox wording or links |
| Credentials/tokens/complete auth links stay private | PASS; 56 captured responses, browser console/errors, available runtime/test logs, working files, staged evidence, and reachable Git history have zero audit findings |

The fresh resend link also returned 400 on reuse. Received links were handled privately; no passwords, tokens, full verification/reset links, or SMTP credentials are in committed evidence. The two QA accounts were disabled, sessions revoked, and remaining auth links retired; encrypted delivery and audit history were retained.

Certification discovered an application privacy defect: verification/reset query tokens appeared in server-rendered HTML and React payloads. The recipient browser now reads the token without server props. The proxy renders a clean request without the token; HTTP loopback rendering handles Cloudflare's forwarded HTTPS and avoids Next's retention of the original query during an internal rewrite. Existing emailed query links still work. Strict CSP remains enabled. Both browsers pass all eight isolated cases across verification/reset and plain/forwarded HTTPS; four public HTML/React payload checks also pass. See [auth-fix-validation.json](stabilization-phase-b-smtp-evidence/auth-fix-validation.json) and [auth-link-privacy.json](stabilization-phase-b-smtp-evidence/auth-link-privacy.json).

Earlier remote customer Product/workspace checks used preverified fixtures and remain separate preserved evidence. This final run certifies actual remote registration and email transport.

## Product Reference UX

| Visible card | Existing purpose mapping | Media |
|---|---|---|
| Front | FRONT | Image |
| Back | BACK | Image |
| Side | LEFT_SIDE / legacy RIGHT_SIDE | Image |
| Packaging | PACKAGING | Image |
| Cap / Pump | CAP_PUMP | Image |
| Texture | TEXTURE | Image |
| Real Usage | USAGE_IMAGE / USAGE_VIDEO | Image or MP4 |
| Additional Reference | OTHER / legacy PRODUCT_VIDEO | Image or MP4 |

The supplied Phase B design specifies seven roles. Repository documentation did not define a specific eighth card contract; the existing eleven-purpose enum in `src/lib/media-validation.ts` is not an eight-card design. **Additional Reference** uses the existing generic purpose rather than inventing another specialized role. Existing purpose/MIME policies and AI provider reference limits remain unchanged.

`product_reference_slots` has a composite workspace/Product/asset foreign key. Migration backfills a deterministic latest READY selection for each legacy role without rewriting immutable media or job snapshots. The cover also has a composite foreign key. Unselected legacy versions remain available to frozen jobs.

## Media Lineage

The isolated lineage test creates a v1 reference and fake AI job, automatically replaces Front with v2, and creates a future job. The first job still freezes v1; downloading its original frozen storage key yields the original SHA-256. The future job freezes v2. Archive/restore preserves current information, rules, cover, and references; removing a chosen Back cover falls back to Front.

Live database preservation hashes additionally confirm all preexisting **20 job snapshots, 27 READY media versions, 8 Product information versions, and 8 rule versions** remain identical. See [live-history-preservation.json](stabilization-phase-b-evidence/live-history-preservation.json).

## Workspace Isolation

Customer creation uses the existing membership model and a zero-balance wallet trigger. Chrome and Edge verify active-session identity and visible selection through repeated switches, current Product data, and foreign direct-ID denial. Tenant page state is remounted on workspace identity changes; private media requests include that identity and version. Owned remote QA workspaces also passed direct-ID isolation and retained zero available/reserved Tokens.

## Token UX

Required/available values and affordability come from the authoritative quote API. Native disablement prevents pointer/keyboard submission while unaffordable; insufficient balance has no loading cursor. Refreshing quote state enables the action when the server returns enough Tokens. A controlled ledger adjustment after quoting proves stale client state still receives server 402 before any job/reservation admission. No shared wallet or pricing/package changes were made.

## Automated Validation

Final result counts and command details are recorded in [validation-summary.json](stabilization-phase-b-evidence/validation-summary.json) and the isolated run evidence. The standard browser command collects the 35 integration cases and six browser journeys, so those counts are overlapping, not additive.

| Validation | Final evidence |
|---|---|
| Original Phase B `npm run test:unit` | 77/77 PASS; preserved original evidence |
| Final SMTP certification `npm run test:unit` | 82/82 PASS, including five new auth privacy cases |
| Final SMTP Chrome/Edge privacy checks | 8/8 PASS; plain and forwarded HTTPS |
| Final public auth HTML/React payload checks | 4/4 PASS |
| Integration coverage | 35/35 PASS in the subsequent full browser collection |
| `npm run test:browser` collection | 41 cases: integration 35 + customer browser 6 |
| Corrected customer journeys, `npm run test:browser -- tests/browser` | 6/6 PASS |
| Phase B deterministic acceptance | 8/8 PASS, actual Chrome and Edge |
| Phase A focused security/media/console | 6/6 PASS |
| Phase A real worker process-loss/bounds | 7/7 PASS |
| Worker `python -m unittest discover -s tests -v` | 74/74 PASS |
| Lint / typecheck / production build | PASS / PASS / PASS |
| Remote Chrome / Edge customer flows | PASS / PASS |
| Secret audit | PASS; ignored private environment; zero findings |

The first `npm run test:integration` run passed 34/35; its recovery test read the previous expired local-mail file before asynchronous new delivery completed. The test now waits for a different token, and all 35 integration cases passed in the subsequent full 41-case browser run. That run passed 40/41: the only failure expected the old `700 tokens` label. The assertion now checks `Required: 700 Tokens`; all six customer journeys were rerun and passed. These were corrected test assumptions, with no remaining failed regression case. Per-run files retain these initial results rather than presenting them as successful command exits.

Reproduction: from `saas`, use `node tests/phase-b/run.mjs --suite phase-b`, `--suite integration`, `--suite browser`, `--suite focused`, and `--suite restart`. The runner owns fresh databases/buckets/gateways and clears real provider credentials. `PHASE_B_TEST_PORT` / `PHASE_B_STORAGE_PORT` can select separate loopback ports for independent suites. `--suite browser-retry` runs the six customer journeys. Local logs and full Playwright output are in ignored `test-data/stabilization-phase-b`; sanitized summaries/screenshots are in this report's evidence directory. Remote script is `node --import tsx tests/phase-b/remote-checks.ts`, restricted to the configured remote-test origin and owned QA fixtures.

## Remote Evidence

[remote-checks.json](stabilization-phase-b-evidence/remote-checks.json) records actual Chrome 154.0.8037.98 and Edge 154.0.4258.53 over public HTTPS. Both pass customer creation/switching, eight reference cards, private uploads, Front default/manual cover, covered v2 replacement, catalogue image loading, archive/restore, fresh editor cover badge, responsive layouts, and isolation. Both report zero console errors, uncaught errors, or configured-secret leaks. Email obfuscation wrappers and email-decode script are absent on checked public auth pages; strict CSP remains present.

Example screenshots: [remote desktop](stabilization-phase-b-evidence/remote-chrome-1440.png), [remote mobile](stabilization-phase-b-evidence/remote-chrome-390.png), [remote tablet](stabilization-phase-b-evidence/remote-msedge-768.png).

## Phase A Regression

Focused security/media checks: **6 PASS**. Storage signing/forgery/expiry/listing guards, corrupt Product/source rejection before Token admission, bounded probing, failed retention, single-connection finalization, catalogued safe worker errors, and real Chrome/Edge critical pages/media/downloads/console all remain PASS. Real worker recovery checks: **7 PASS**. SIGKILL at Downloading, Transcribing, Analyzing, Rendering, Uploading, and Finalizing preserves recoverable checkpoints, advances attempt fencing, refuses late old-lease progress/completion, produces two final clips once, and captures once. Lost leases stop at `maxAttempts` and release once. See `restart-*.json` and [restart-run.json](stabilization-phase-b-evidence/restart-run.json).

All **61 original Phase A and Master Acceptance report/evidence files** match their pre-change SHA-256 hashes; see [preserved-original-evidence.json](stabilization-phase-b-evidence/preserved-original-evidence.json). No storage credential rotation was rerun. The existing Phase A test evidence helper accepts an alternate evidence directory so this regression writes only Phase B evidence.

## Paid Operations

- real AI Video inference calls: **0**
- real WaveSpeed LLM calls: **0**
- Outreach sends: **0**
- real payment charges: **0**

Test jobs, test wallet funding/adjustments, and simulated payments run only in uniquely owned isolated databases/private buckets with real provider credentials cleared. Remote checks create no jobs or payments.

## Data Mutation Summary

Two additive forward migrations were applied to the remote-test database: nullable mail-token linkage, cover pointer, current reference selections/backfill, and pending-slot uniqueness. Old applied migrations were not edited. Existing frozen job/media/Product/rule hashes remain unchanged.

Original Phase B private runtime change: initialize the absent mail encryption key; rebuild/restart the SaaS on loopback 3200. No existing storage, WaveSpeed, or payment credentials were rotated or changed. No SMTP credentials were invented. Final SMTP certification reused operator-configured SMTP without credential/configuration changes, rebuilt the scoped auth privacy fix, and restarted the SaaS with output in an ignored runtime log.

Two successful remote QA runs created two owned preverified QA users, eight workspaces, and four Products with synthetic private references. All fixture sessions were revoked, users disabled, and workspaces/Products archived. Their immutable media remains retained. No old customer fixture/evidence was deleted. Isolated test runners remove only their own database/bucket/gateway and owned local mail files; per-run cleanup is recorded.

The final SMTP run additionally created two controlled QA accounts and four real auth email deliveries. It created no workspaces, Products, jobs, wallet mutations, or payment activity. Both accounts are disabled, all their sessions revoked, and auth links retired, following the existing fixture policy without deleting delivery/audit history. [Final live-history preservation](stabilization-phase-b-smtp-evidence/live-history-preservation.json) confirms unchanged hashes for the pre-certification 20 jobs, 39 READY media versions, 12 Product information versions, and 12 rule versions. [Final evidence preservation](stabilization-phase-b-smtp-evidence/preserved-original-evidence.json) confirms all 105 original Phase A/Master and Phase B evidence files remain identical; this authorized Phase B report update is excluded from that manifest.

## Remaining Deferred Work

- **BILLING-001 — account-level shared wallet migration:** Phase C. New workspaces currently have independent empty wallets; no Token duplication, transfer, merged ledger, or ownership migration.
- **CLIPPER EDITING & VARIATIONS:** separate phase.
- **OUTREACH SAAS:** separate phase.
- **PHASE 10:** not started.

## Git

Original implementation: `308f5fc952da5d3a0804f6b1d44f81263749794c` — **Stabilize customer onboarding workspace and product UX**. Original documentation/evidence: `26421581d6ff478779152cd6a9b3093bb4d8684d` — **Document Stabilization Phase B**. Final SMTP certification, sanitized evidence, and the necessary auth privacy fix are committed as **Certify remote SMTP and complete Phase B**; its commit identity is reported with the final response. No push is performed. Phase C is not started.
