# Master Acceptance — Tests 20–28

Date: 2026-10-05, Asia/Shanghai. Project: `C:\Data\ai-site\saas`. Remote: `https://ai-test.proyaofficial.com`.

**Overall: FAIL — 3 PASS, 6 FAIL, 0 BLOCKED. Paid beta is blocked by public storage signing-credential exposure and corrupt MP4 admission.**

Product implementation was left unchanged. New code is test infrastructure, fixture setup, diagnostics, and reports. Existing uncommitted WaveSpeed changes were preserved. Next-generated TypeScript configuration changes were restored. No Phase 10, Clipper editor parity, Outreach implementation, billing redesign, or fixes to the operator's previously listed findings were undertaken.

The definitive full run is `1791197084690_a73a90`: nine automated scenarios, three passed and six failed in 135.6 seconds. Several scenarios deliberately combine browser compatibility, response scanning, and console checks; their individual evidence is separated below. The expanded persistence supplement is `1791197746502_4705d8`: one scenario passed in 30.8 seconds. Earlier harness problems were corrected and excluded from product defect classification.

Evidence is in `C:\Data\ai-site\saas\docs\master-acceptance-evidence\`. Detailed runtime logs/results are in ignored `test-data/master-acceptance/`. No credential values, session cookies, or complete signed URLs are included in this report or the saved evidence JSON.

## Test 20 — File Validation

Status: FAIL

Evidence:

- `master-acceptance-evidence/test20.json` contains the full upload matrix, SQL state checks, and wallet/job/provider comparisons.
- Product uploads rejected renamed text as MP4, unsupported GIF, zero-byte images/videos, MIME/content mismatch, and corrupt PNG headers with safe 415/413/422 responses.
- Oversized advertised image/video/source sizes returned 413. Actual 17 KB JSON and streamed 20,480-byte JSON without Content-Length returned 413. An actual 32,769-byte object exceeded the isolated 32,768-byte image limit and returned 422. Production limits were unchanged; no multi-GB files were created.
- A valid PNG with path-like, Unicode, markup, and control characters in its filename finalized, downloaded byte-for-byte unchanged, and had safe Content-Disposition handling.
- Invalid uploads caused no additional AI provider executions or private-worker leases. The corrupt-source job described below was cancelled by the harness; its reservation was released. Final wallet values equalled the settled baseline, with zero reserved tokens.

Failures:

- A 20-byte non-video containing `ftyp` at the expected offset became a READY Product video asset and an UPLOADED Clipper source. Clipper submission returned 201 and reserved 700 isolated fixture tokens. No real worker or paid inference executed it.
- Four validation-failed staging objects remained after their records were aged beyond 24 hours and the existing test-only cleanup command was applied. The current operations documentation explicitly limits automatic cleanup; no bucket lifecycle policy was applied by this task.

Severity:

- HIGH: QA-20-001, corrupt media admission and inappropriate job/token reservation.
- MEDIUM: QA-20-002, retention/cleanup coverage gap for validation-failed staging uploads.

## Test 21 — Signed URL Expiry / Storage Authorization

Status: FAIL

Evidence:

- `master-acceptance-evidence/test21.json` records both normal signature checks and the controlled credential-exposure proof.
- Original signed download returned 200. Unsigned, signature-tampered, unchanged-signature object-substitution, and bucket-listing transformations returned 403. The other controlled workspace received 404 from the authenticated URL-issuance API.
- A directly signed, isolated one-second Content object URL expired and returned 403 after 2.2 seconds. Its Content Library record remained present. A fresh authenticated media URL returned 200. Customer/production TTLs were not changed.

Failures:

- The configured public access-key identifier equals the signing secret. The public credential field in object A's signed URL therefore reveals the signing secret.
- Using only that public field as the two signing credential inputs, the harness signed a URL for object B in a different controlled QA workspace. Object B returned 200 through both the isolated gateway and `https://storage-test.proyaofficial.com`.
- The second object belonged to the newly created QA bucket. No existing customer object, bucket listing, write, or deletion was attempted through the exposed credential.

Severity:

- BLOCKER: QA-21-001. Normal expiry/signature checks do not contain the risk when a recipient can mint new signatures. This is also the confirmed secret exposure in Test 26.

## Test 22 — Logout Security

Status: PASS

Evidence:

- `master-acceptance-evidence/test22-local.json` and `test22-remote.json` cover real server authentication with controlled identities, without mocked authorization.
- Local and real remote protected pages worked before logout. Replaying the old session cookie returned 401 from session and private Products APIs after logout.
- Browser Back did not restore usable authenticated access; the remote check found no private account view after Back. Protected reload and direct Settings navigation required login.
- PostgreSQL session rows showed server-side revocation. Expiring only the controlled session in the database also returned 401.
- Remote session cookies were Secure, HttpOnly, SameSite=Lax. Local HTTP cookies were HttpOnly/Lax with Secure=false, as expected for loopback HTTP.
- Session cookie values did not appear in customer HTML, document.cookie, localStorage, or sessionStorage. No cookie values were logged or saved.

Failures:

- None in the tested session lifecycle. The previously reported signup/email findings were not re-investigated.

Severity:

- None.

## Test 23 — Browser Compatibility

Status: FAIL

Evidence:

- Actual Chrome channel: `154.0.8037.93`. Actual Microsoft Edge channel `msedge`: `154.0.4258.53`. Both launched successfully; Chromium was not substituted for Edge.
- `test23-chrome.json`, `test23-msedge.json`, and `remote.json` contain routing and media evidence.
- Login, Home, Products, AI Videos, Clipper, Content Library, Settings, and Billing rendered in both browsers. Local navigation links worked, forms rendered, Product references loaded, and Product asset editor controls appeared.
- Valid completed fixture AI Video, clip, Content video, Content clip, and original source elements loaded with readyState 4 and no media errors. Authenticated video/clip downloads returned 200 with 12,347 and 94,215 bytes respectively in each browser.
- Remote real form login, authenticated navigation, and logout succeeded in the controlled account. No remote products, generated jobs, or fake provider settings were created.
- The known catalogue-cover issue PRODUCT-001 remains a prior operator finding; it is not assigned a new QA ID.

Failures:

- Both remote browsers emitted eight recoverable React #418 hydration exceptions during the normal authenticated navigation observation. Routing recovered and actions worked, but error-free browser acceptance was not met.
- This was common to both browsers, not an Edge-only failure. Origin/edge comparison confirmed Cloudflare email markup and script insertion in remote HTML only; see QA-23-001 and Test 27.

Severity:

- MEDIUM: QA-23-001.

## Test 24 — Responsive UI

Status: PASS

Evidence:

- `test24-local.json` contains Login plus twelve authenticated page/editor paths at 390×844, and twelve authenticated paths at 768×1024. `test24-remote.json` covers eight authenticated remote paths at 390×844.
- Home, Products/new Product, Product basic/assets/rules editor steps, AI Video creation, Clipper creation, Content Library/detail, Settings, and Billing were checked where implemented.
- Viewport/document widths matched; no measured horizontal overflow or clipped buttons/inputs/selects/textareas were found. All ten navigation links remained accessible on authenticated pages.
- AI Video and Clipper form fields were populated without submitting generation/clipping. Existing populated Content and Product fixtures were used locally.
- No custom modal/dialog is used by these tested flows. Product editor steps are routed pages. The native browser Archive confirmation was not exercised as a destructive flow.

Failures:

- None meeting the functional/layout thresholds. Minor spacing/font differences were not treated as responsive failures.

Severity:

- None.

## Test 25 — Customer-Facing Error Quality

Status: FAIL

Evidence:

- `test25.json` records HTTP and rendered UI failure observations.
- Invalid login, Product validation, and invalid source size returned safe customer messages. A controlled PostgreSQL trigger exception and a temporarily stopped owned test gateway produced generic, safe 500 responses rather than SQL, filesystem, or connection details.
- Only the newly created test gateway was stopped/restarted. The real remote gateway and private worker were not stopped.
- A worker message containing forbidden path/punctuation syntax was rejected with safe 400. A permitted-character message containing synthetic internal terms was accepted and observed in both customer HTTP responses and UI.

Failures:

- Worker progress and failure messages containing connection-refusal text, a private IP/port, traceback/exception names, and a credential field name passed through the Clipper detail API and failed-job page.
- Only synthetic diagnostic markers were sent. No real credential, provider raw response, or actual Python traceback was injected or exposed.

Severity:

- MEDIUM: QA-25-001, insufficient semantic sanitization of trusted-worker diagnostic text.

## Test 26 — Secret Leakage

Status: FAIL

Evidence:

- `secret-audit.json`: 589 tracked files, 585 inspected text files, four excluded binary files, zero staged files, and no confirmed credential-context findings. `.env.local` remains ignored. This audited current tracked files/staged index, not full Git history.
- Preliminary database-password substring matches in documentation/framework bundles were ordinary-word collisions. Credential-context checks and two regression tests exclude them; they are not newly discovered secret leaks.
- `test26-browser-chrome.json`, `test26-browser-msedge.json`, and `remote.json` show no confirmed WaveSpeed, worker, database, SMTP, payment, mail-encryption, or session-secret value in inspected customer HTML, JS, API/JSON, React hydration responses, or browser console text.
- Each local browser scanned seven HTML, 33 JavaScript, 40 JSON, six React-component, and one CSS responses. Transcript and clip-plan JSON downloads returned 200 and contained no detected credential value. Remote response scans likewise reported no separate credential finding.
- Raw cookies and full signed URLs were never written to the report or evidence. Signed URLs were otherwise evaluated for scope and expiry in Test 21.

Failures:

- QA-21-001 is a confirmed signing-secret exposure through the public signed-URL credential field. Generic source/bundle scanning alone cannot clear this configuration flaw.

Severity:

- BLOCKER: same underlying defect QA-21-001; no duplicate defect is counted.

## Test 27 — Console / Network Cleanliness

Status: FAIL

Evidence:

- `test27-chrome.json`, `test27-msedge.json`, `remote.json`, and `remote-html-diagnostic.json` contain the relevant observations.
- Local normal navigation had zero uncaught JS exceptions, zero failed same-origin API responses, zero websocket errors, and no detected polling storm. Counts were evaluated per actual endpoint within ten-second windows rather than combining different artifact IDs.
- Remote normal navigation had no captured failed same-origin API responses or websocket failures. Hydration and CSP errors were present; no browser-extension noise was involved.
- Read-only comparison of the same controlled fixture at origin and edge showed no Cloudflare email wrapper/script at origin. Edge responses added one protected-email wrapper on Home/Products and five on Settings, plus `email-decode.min.js`.
- The existing CSP blocked that injected script. Both remote browsers emitted recoverable React #418 exceptions. React identifies #418 as a server/client hydration mismatch with client regeneration ([official error decoder](https://react.dev/errors/418)). Edge HTML rewriting is a strongly supported cause; no configuration change or controlled edge-toggle fix experiment was performed.

Failures:

- QA-23-001: remote hydration exceptions and blocked Cloudflare email-decoding scripts.
- QA-27-001: Google Fonts stylesheet imports are blocked by the existing style-src policy, yielding repeated customer-console CSP errors in both browsers.
- QA-27-002: `/favicon.ico` returns 404 at both origin and remote; Chrome recorded a missing-resource console error. No same-origin API 500 loop or media CORS failure was found.

Severity:

- MEDIUM: QA-23-001.
- LOW: QA-27-001 and QA-27-002.

## Test 28 — Final Persistence

Status: PASS

Evidence:

- `test28-local.json`, `test28-remote.json`, and `run-summary-persistence.json` contain fresh-context persistence results.
- Local test logged out, created a new browser context with no saved cookie state, logged in through the actual form, reloaded, and compared exact authenticated API snapshots.
- Persisted snapshots matched for user/account, workspace membership, Products, Product information/references, wallet, token ledger, AI Video history/artifacts, Clipper source/history/artifacts, Content Library, team membership, a saved unstarted workflow definition, and a fake-provider PAID payment.
- Three renewed signed artifact/source downloads returned 200 after the new login. Completed media came from static/fake fixtures; no paid generation or workflow execution was required.
- The real remote test similarly preserved account, membership, and empty QA workspace data across logout/new context/form login/reload. Existing populated histories/artifacts were validated in isolated fixtures, not by borrowing customer resources.
- Outreach persistence: NOT IMPLEMENTED / separate future phase. It does not fail this test.

Failures:

- None in the tested persisted data. Workflow definitions were tested without starting workflow runs.

Severity:

- None.

## Newly Discovered Defects

### QA-20-001 — Corrupt MP4 accepted and billed for job admission

- Severity: HIGH.
- Reproduction: create an owned upload intent for a 20-byte `.mp4` containing the expected `ftyp` marker but no decodable video; upload/finalize through Product and source APIs; submit a Clipper quote/job for the accepted source.
- Expected: reject corrupt video safely before READY/usable source status, job creation, or token reservation.
- Actual: Product asset READY; source UPLOADED; Clipper job 201 with 700 fixture tokens RESERVED. Harness cancellation released the reservation; no paid provider or private-worker execution occurred.
- Impacted: `src/lib/media-validation.ts`, `src/lib/assets.ts`, `src/lib/sources.ts`, Product finalize and source finalize endpoints, Clipper job admission.
- Paid beta blocked: YES, until this admission boundary is stabilized.

### QA-20-002 — Failed staging uploads outside applied cleanup coverage

- Severity: MEDIUM.
- Reproduction: fail image/video validation, age only those owned failed version records past 24 hours, run `node scripts/cleanup-pending.mjs --apply --test` in the new database/bucket, then HEAD their staging objects.
- Expected: an implemented/agreed retention policy handles validation-failed temporary objects.
- Actual: all four failed staging objects remained. The cleanup command selects PENDING_UPLOAD versions; operations documentation describes broader cleanup as report-only/manual and recommends a vendor lifecycle that is not automatically applied.
- Impacted: `scripts/cleanup-pending.mjs`, asset failure handling, `docs/phase9/storage-operations.md`, storage retention operations.
- Paid beta blocked: NO standalone immediate blocker; resolve or explicitly establish the retention procedure during stabilization. Do not broaden deletion over historical media.

### QA-21-001 — Public credential identifier reveals signing secret

- Severity: BLOCKER.
- Reproduction: obtain object A's authenticated signed download in controlled workspace A; privately compare its public credential identifier with the configured signing secret; use the public identifier alone to sign object B's URL in controlled workspace B and the new QA bucket.
- Expected: public access-key identifiers differ from signing secrets; A's URL cannot supply credentials that mint B access.
- Actual: identifier equals secret; newly signed B URLs return 200 locally and through the real remote storage hostname. Merely altering A's path/signature still returns 403, and application workspace authorization still denies B's URL-issuance request.
- Impacted: current object-storage credential configuration, `src/lib/storage.ts`, `docker/s3-gateway.mjs`, public storage deployment, and every customer endpoint that issues signed media URLs. This is a configuration/credential-secrecy failure rather than proof of a broken SigV4 algorithm.
- Paid beta blocked: YES; immediate attention. No credential value is included here. Credentials were not changed/rotated and no existing customer object was accessed.

### QA-23-001 — Remote edge rewrites HTML and produces hydration exceptions

- Severity: MEDIUM.
- Reproduction: log into the controlled remote account in Chrome and Edge, navigate the tested authenticated pages, and capture pageerror/console events; compare identical owned fixture pages at origin versus edge.
- Expected: stable server/client DOM and no hydration exceptions or blocked injected scripts during normal customer navigation.
- Actual: eight React #418 exceptions per browser in the normal observation; remote HTML adds protected-email wrappers/script absent at origin. Existing CSP blocks `email-decode.min.js`. Client regeneration recovered routing/actions. Edge rewriting is the supported causal inference; no edge setting was changed to prove a fix.
- Impacted: Cloudflare email-obfuscation/HTML transformation configuration, Shell/Settings email rendering, remote authenticated pages, existing CSP in `src/proxy.ts`. No browser-specific exclusive failure was found.
- Paid beta blocked: YES for signing off error-free browser acceptance; this is not the immediate security blocker.

### QA-25-001 — Worker diagnostics reach customer messages

- Severity: MEDIUM.
- Reproduction: use an owned fixture worker/lease to submit progress/failure messages containing internal terms that fit the permitted character whitelist; read the owning workspace's Clipper detail API and failed-job UI.
- Expected: customer-safe progress/failure messages regardless of unexpected worker diagnostic text.
- Actual: connection-refusal text, private port, traceback/exception names, and a credential field name reach HTTP/UI. Punctuation filtering blocks some paths but does not make all accepted text safe. Only synthetic markers were used; no real credential leakage was demonstrated through this path.
- Impacted: `src/lib/worker-core.ts` textField/workerProgress/workerFail, `src/lib/clipper.ts`, `src/components/clipper-job-view.tsx`, `/api/worker/jobs/:jobId/progress`, `/fail`, owning Clipper detail/page.
- Paid beta blocked: YES for the explicit customer-safe error acceptance requirement; stabilize message mapping before signoff.

### QA-27-001 — Font stylesheet blocked by own CSP

- Severity: LOW.
- Reproduction: open/navigate customer pages with the unchanged CSP and capture console/requestfailed events.
- Expected: page styling dependencies load without repeated CSP errors.
- Actual: `https://fonts.googleapis.com/css2` is blocked by style-src; fallback fonts remain usable. Seven failures appeared in each local normal-navigation observation; remote observations also included them.
- Impacted: `src/app/globals.css` external font import and `src/proxy.ts` policy, customer pages.
- Paid beta blocked: NO standalone blocker. Do not weaken CSP globally as a test workaround.

### QA-27-002 — Missing favicon request

- Severity: LOW.
- Reproduction: GET `/favicon.ico` at loopback origin and remote test hostname; observe Chrome's initial navigation console.
- Expected: a valid static icon or clean explicitly configured icon route.
- Actual: both GETs return 404; Chrome recorded a failed-resource console message.
- Impacted: `/favicon.ico` and static icon/metadata configuration.
- Paid beta blocked: NO standalone blocker.

## Security Summary

- Immediate blocker: QA-21-001, signing secret recoverable from a public signed URL. The attack proof used only controlled objects/workspaces in the owned bucket.
- Normal signature tampering/expiry, authenticated workspace URL issuance, logout revocation, session expiry, secure remote cookie flags, and absence of session credentials in client storage passed.
- Current tracked/staged repository and customer bundle/API/manifest scans found no separate confirmed configured credential leak. Short common-word collisions were rejected with contextual checks, not reported as breaches.
- No auth was disabled; no bucket made public; no signature/workspace validation disabled; no remote fake providers enabled; no production TTL reduced; no credentials rotated or printed.
- The operator's existing CLIPPER-RECOVERY-001 paid-beta gate remains unresolved and outside this validation/fix scope.

## Browser Compatibility Summary

| Capability | Chrome | Microsoft Edge |
|---|---|---|
| Actual requested channel launched | PASS | PASS (`msedge`) |
| Local critical navigation/forms/references | PASS | PASS |
| Existing fixture video/clip/source playback | PASS | PASS |
| Authenticated video/clip downloads | PASS | PASS |
| Remote form login and critical page rendering | PASS | PASS |
| Remote hydration/console cleanliness | FAIL, MEDIUM | FAIL, MEDIUM |

## Responsive Screenshots

No responsive failure screenshots were produced: tested pages had no meaningful clipped controls, destructive horizontal overflow, or inaccessible navigation. Numeric layout evidence is in `test24-local.json` and `test24-remote.json`. Hydration, CSP, and credential findings are HTTP/console/security evidence rather than responsive layout failures.

## Tests Added / Changed

- `playwright.master-acceptance.config.ts`: dedicated one-worker acceptance configuration and separate app ports/dist directory.
- `tests/master-acceptance/run.mjs`: new owned database/private bucket/gateway, fake providers, real controlled remote identity, cleanup, history fingerprints, and persistence-only mode.
- `tests/master-acceptance/boundaries.spec.ts`: Tests 20/21/22/25/28 with deterministic invalid files, streamed size boundary, storage attacks, session revocation/expiry, controlled SQL/storage/worker failures, and fresh-login snapshots.
- `tests/master-acceptance/browsers.spec.ts`: actual Chrome/Edge routing/media/download checks, response/manifest scanning, network/polling capture, and responsive checks.
- `tests/master-acceptance/remote.spec.ts`: controlled real remote authentication, navigation, mobile layout, logout, and fresh-session persistence. It waits for form hydration before interacting so pre-hydration native submission is not misclassified as a product auth failure.
- `tests/master-acceptance/support.ts`, `secret-audit.mjs`, `remote-html-diagnostic.mjs`, and `README.md`: fixture helpers, secret-safe contextual scanning, read-only edge diagnosis, and run instructions.
- `tests/unit/master-acceptance-scanner.test.ts`: two scanner regressions for ordinary-word collisions and category-only output.
- Existing product/worker implementation and existing tests were not edited by this validation task.

## Exact Test Command Results

Commands run from `C:\Data\ai-site\saas`:

| Command | Result |
|---|---|
| `node tests/master-acceptance/run.mjs` | Exit 1; definitive full run: 9 scenarios, 3 passed, 6 failed, 0 skipped, 0 flaky; 135.6 s. Failures represent the documented product/deployment findings. |
| `node node_modules/@playwright/test/cli.js test -c playwright.master-acceptance.config.ts` | Under the isolated runner environment: exit 1; same 3/6 full-run result. Direct execution without isolation variables is intentionally refused. |
| `node tests/master-acceptance/run.mjs --persistence-only` | Exit 0; 1 passed, 0 failed; 30.8 s, including populated workflows/payments/team/ledger snapshots. |
| `npm run test:unit` | Exit 0; 67 passed, 0 failed, 0 skipped. |
| `node tests/master-acceptance/secret-audit.mjs` | Exit 0; tracked/index scan passed, zero confirmed findings, `.env.local` ignored. Overall Test 26 still fails due to QA-21-001. |
| `node tests/master-acceptance/remote-html-diagnostic.mjs` | Exit 0; three origin/edge pairs read successfully; edge-only email rewrites confirmed; diagnostic session retired and fixture status restored. |
| `npm run lint` | Exit 0. |
| `npm run typecheck` | Exit 0. |
| `git diff --check` | Exit 0. |

Earlier test-harness collection/module, selector, hydration-wait, and empty browser-history assumptions were repaired. Their failed attempts are not separate product defects. Two empty preflight remote identities were deleted; executed full-run identities were retained disabled. A persistence-only filter typo produced a no-tests run with zero fixtures; it was corrected before the passing supplement.

## Paid Operations

- real AI Video generations: 0
- real WaveSpeed LLM paid calls: 0
- Outreach sends: 0

Completed media were static/fake fixtures. Payment persistence used only the local fake payment provider. There were no real paid provider POSTs, real Outreach requests, or workflow executions in these tests.

## Data Mutation Summary

- Each harness attempt owned a new, uniquely named PostgreSQL database, private bucket, and separate gateway. All of those resources were deleted after use. Existing customer/test databases, buckets, the remote gateway, and private worker were not recreated or cleaned.
- Definitive full run created/deleted 2 isolated users, 2 workspaces, 2 Products, 7 assets/versions, 4 jobs, 5 artifacts, 5 sources, 2 fixture workers, 3 Content items/versions, 2 wallets, and 8 ledger entries. Cleanup removed 26 remaining owned storage objects and 2 owned mailbox files. Earlier matrix runs' owned resources were also deleted.
- Persistence supplement created/deleted 2 isolated users/workspaces/wallets, 1 Product/reference/source, 2 completed fake/static jobs, 5 artifacts, 1 fixture worker, 3 Content items/versions, 6 ledger entries, 1 unstarted workflow definition, and 1 fake PAID payment. Cleanup removed 15 owned objects and 2 mailbox files.
- Remote retained fixtures from three executed full runs: 3 empty QA workspaces and 3 disabled QA accounts, with their sessions revoked/expired. Two empty module-collection preflight accounts were deleted. No remote Product, source, artifact, generated job, paid payment, or fake provider setting was created.
- The HTML comparison temporarily reactivated only the final owned QA account, inserted one two-minute diagnostic session, then revoked that session and restored DISABLED. Its password was not changed.
- Full-run before/after fingerprints matched for existing jobs, job artifacts, sources, Products, asset versions, Content items/versions, wallet state, and token ledger. The post-diagnostic `final-data-audit.json` reconfirmed unchanged historical fingerprints and all three retained QA accounts disabled. Historical jobs/assets were not modified. Owned fixture rows were explicitly excluded where needed; all object attack targets belonged to controlled fixtures.
- Test reports/evidence and ignored runtime/build output remain for review. No customer historical source, artifact, job, Product, or ledger record was deleted or altered by the test operations.

## Final Tests 20–28 Result

| Test | Result | Severity if failed |
|------|--------|--------------------|
| 20 File Validation | FAIL | HIGH; cleanup MEDIUM |
| 21 Signed URLs | FAIL | BLOCKER |
| 22 Logout Security | PASS | — |
| 23 Browsers | FAIL | MEDIUM |
| 24 Responsive | PASS | — |
| 25 Error Quality | FAIL | MEDIUM |
| 26 Secret Leakage | FAIL | BLOCKER, same QA-21-001 |
| 27 Console/Network | FAIL | MEDIUM; fonts/favicon LOW |
| 28 Persistence | PASS | — |

Recommendation: **specific blocker requiring immediate attention — QA-21-001, public storage signing-credential exposure.** Proceed to a separately authorized stabilization phase, prioritizing that blocker and QA-20-001, then the remaining findings. Keep the existing Clipper recovery gate on the paid-beta checklist. This task did not apply product fixes or rotate credentials.
