# Stabilization Phase A — Security, Integrity & Recovery

Date: 2026-10-06 (Asia/Shanghai). Repository: `C:\Data\ai-site`. Remote test deployment: <https://ai-test.proyaofficial.com>.

Implementation commit: **ef98f0b95218f8e1975c8cf9b64ecfc850b250d2** — `Stabilize storage security media validation and job recovery`. This report and the final documentation audit follow in a separate documentation commit.

## Outcome

Overall status: **PASS**. All seven Phase A priorities have passing focused verification. The storage signing blocker and corrupt-media HIGH issue are fixed. The Clipper worker-loss recovery gate passes. Remote Chrome and real Microsoft Edge have clean hydration and console results after the operator corrected the hostname-specific Cloudflare rule. The final integration rerun passes 35/35.

The original Master Acceptance report and evidence remain untouched. Phase B findings and future phases remain in the backlog below.

| Priority / finding | Result | Verification |
| --- | --- | --- |
| P0 / QA-21-001 — BLOCKER | FIXED | Credentials rotated; retired signatures and newly minted retired-credential URLs return 403; fresh URLs return 200. |
| P1 / QA-20-001 — HIGH | FIXED | Actual bounded video decoding rejects corrupt media before usability, job admission, and token reservation. |
| P2 / CLIPPER-RECOVERY-001 | FIXED | Six real worker-process interruption stages recover; retry bounds, fencing, checkpoints, publication, and single charging pass. |
| P3 / QA-25-001 — MEDIUM | FIXED | Fixed stage/error catalogs protect new worker messages and historical customer reads. |
| P4 / QA-23-001 — MEDIUM | FIXED | Edge rewriting is absent; Chrome and Edge report zero hydration/console errors. |
| P5 / QA-20-002 — MEDIUM | FIXED | Scoped, age-based, bounded cleanup with dry-run and audit output passes. |
| P6 / QA-27-001 and QA-27-002 — LOW | FIXED | System fonts use existing CSP; `/favicon.ico` returns 200. |

Remaining Phase A BLOCKERS: **0**. Remaining Phase A HIGH issues: **0**.

## QA-21-001: signing configuration and rotation

SigV4 already used separate access-key and secret fields. The compromised test configuration assigned identical values, exposing the signing secret in the public credential identifier. A shared guard now rejects missing credentials and identical values in storage client construction, gateway startup, storage initialization, and configuration/preflight checks. Errors never include credential values. Permanent unit regressions exercise both signing clients and the gateway guard.

The remote-test pair was rotated once, privately in ignored `.env.local`, to a public identifier and a distinct 384-bit random secret. Only the object gateway was recreated; its backing storage and PostgreSQL containers were retained. The updated production build of the SaaS was restarted on `127.0.0.1:3200`, so newly issued upload/download URLs use the rotated pair. The previous elevated SaaS process required the operator to stop it; subsequent owned-process rebuild/restart was completed directly.

| Credential/security proof | HTTP result |
| --- | --- |
| Controlled retired signature before rotation | 200 |
| Same retired signature after rotation, local and public gateway | 403 / 403 |
| New URL minted using retired credentials after rotation | 403 |
| Fresh local/public signed URLs | 200 / 200 |
| Unsigned listing and object-URL-to-listing transformation | 403 / 403 |
| Signature forgery using only the public identifier | 403 |
| Signature tampering / expiry / foreign workspace | 403 / 403 / 404 |

The identifier embedded in fresh URLs differs from the current secret. Browser Product PNG/MP4 uploads and downloads pass in both remote browsers. Content Library browser playback/download passes. The real WaveSpeed Product-reference URL validator passes against public HTTPS storage using GET only; the separate proof also verifies expected bytes, MIME, SHA-256, and the 3,600-second reference TTL. No inference endpoint was invoked.

Existing bucket inventories contained 90 and 489 objects at rotation. Key/ETag/size fingerprints and counts were identical before and after. The rotation proof bucket/object was removed. See `storage-rotation.json`, `test21.json`, `wavespeed-reference-proof.json`, and `remote-checks.json` in this report's evidence directory. Do not rerun the rotation script merely to repeat tests.

## QA-20-001: actual media validation before paid use

`media-probe.ts` runs actual `ffprobe` decoding through a random loopback-only HTTP proxy backed by private S3 ranges. Each read is tied to the object's ETag. Signed storage URLs never enter child-process arguments or reports. Bounds are 20 seconds, 32 MiB of proxy read budget, 128 requests, 4 MiB probe size, 32 MiB per allocation, 256 KiB child output, and a sample of up to 24 frames. Only HTTP/TCP protocols are enabled; external MOV data references are disabled. Validation requires an MP4 container, an actual decoded video frame, supported positive dimensions, and finite positive duration under 24 hours. Clipper sources also require an audio track.

Product finalization validates before READY, retains existing byte/checksum/copy checks, and records decoded dimensions. Source finalization serializes sealing, reuses an interrupted sealed original, and records versioned validation and ETag before UPLOADED. Four finalizations per process are allowed concurrently. Advisory locks use separate short-lived database connections, preserving a query pool configured with only one connection; duplicate sealing returns a fixed retryable response. Lock contention, capacity, and release after failure have an isolated regression.

Legacy UPLOADED/VERIFIED sources receive actual validation at future quote/job admission when a current validation marker is absent. Central paid admission repeats the boundary for workflow callers before token reservation. No legacy source is blindly certified or rewritten. Temporary storage/probe availability failures return a fixed 503 instead of classifying valid media as corrupt.

The 20-byte ftyp-only regression returns 422. Product/source corruption cases never become usable, never admit a paid Clipper job, and leave wallet, ledger, job, provider, and lease counts unchanged. Valid MP4 controls pass, including the existing 69 MiB multipart tests now using an actual decodable audio/video fixture with a valid padding box. The bounded probe samples decoding; it does not certify every frame of an arbitrary large video. FFprobe must remain available on the SaaS host (`FFPROBE_PATH` is supported).

## CLIPPER-RECOVERY-001: worker loss and bounded retry

Worker shutdown now raises retryable `WORKER_INTERRUPTED` instead of behaving like customer cancellation. Interrupted/failed local subprocesses are retryable. The server's fixed Clipper failure catalog classifies known transient failures independently of a stale worker's retry flag. Existing lease expiration, reconciliation, attempt creation, checkpoint validation, and retry ceilings remain the durable control path.

Actual `python worker_agent.py` processes were killed at DOWNLOADING_SOURCE, TRANSCRIBING, ANALYZING_TRANSCRIPT, RENDERING, UPLOADING_RESULTS, and FINALIZING. The upload interruption occurs after a real clip PUT and before its finalize transaction. Only each owned lease's expiration timestamp was advanced to avoid a wall-clock wait. The normal dispatcher/reconciler then created a new attempt, and the same worker command completed the job.

Each case proves LOST → SUCCEEDED, increased fencing, rejection of late old-attempt progress/completion with 409, two final clips/four unique artifact IDs, two Content versions, one publication intent despite three publication replays, one RESERVE, and one CAPTURE. Later-stage retries reuse valid transcript/plan checkpoints; FINALIZING also reuses rendered clips. Three successive lost leases stop at 3/3 attempts with one RELEASE and no fourth attempt. Known `LOCAL_PROCESS_FAILED` remains retryable even if an old worker submits `retriable: false`.

Transcription is substituted by an opt-in test adapter and analysis uses the existing fake provider. Transfers, FFprobe, FFmpeg, leases, checkpoint fingerprints, output verification, completion, publication, and token bookkeeping exercise production code. No deployed worker imports the adapter. Existing configured workers restart with:

```powershell
cd C:\Data\ai-site\worker-agent
python worker_agent.py
```

## QA-25-001: controlled customer messages

Worker progress stages and failure codes map to fixed customer messages. Unknown codes receive a generic safe response. Raw progress/failure text is validated as an envelope but discarded. Clipper detail and general job APIs also map historical persisted messages, attempts, and event codes at read time, preserving stored history. No customer UI change was necessary because its API now supplies controlled text.

Synthetic connection/IP/port, exception/traceback, and credential-field markers are absent from progress/failure APIs, the general job API, historical row reads, and the failed-job UI. Internal logging remains structured and excludes raw credential values. See `test25.json` and the message unit regressions.

## QA-23-001: Cloudflare resolution

Before correction, authenticated origin HTML was clean while edge HTML added protected-email wrappers and `email-decode.min.js`; Chrome and Edge reproduced React #418 and CSP errors. The operator confirmed correction of the deployed configuration rule in the `proyaofficial.com` zone for `(http.host eq "ai-test.proyaofficial.com")`, setting Email Obfuscation Off (`email_obfuscation: false`) after any conflicting matching rule. This is the hostname-scoped control documented by [Cloudflare Email Address Obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/) and [Configuration Rule settings](https://developers.cloudflare.com/rules/configuration-rules/settings/).

After correction, origin/edge comparisons of `/`, `/products`, and `/settings` all return 200, zero protected-email wrappers, zero injected email script, and normal account email text. Remote Chrome 154.0.8037.98 and real Edge 154.0.4258.53 navigate seven authenticated routes with zero hydration exceptions, console errors, request failures, or failing responses. Both show normal account email text. Nonce/strict-dynamic script policy and `object-src 'none'` remain intact. There is no Phase A application change to CSP or proxy behavior.

If the issue recurs, check that the hostname rule is deployed/enabled, explicitly sets Email Obfuscation Off, and follows any conflicting matching rule. Cloudflare Trace for the authenticated hostname should show effective `email_obfuscation: false`. Confirm HTML and both browsers afterward. Direct Cloudflare management access was unavailable; the operator applied the rule and automated checks verified its effect. Before/after evidence is preserved separately.

## QA-20-002: failed temporary upload retention

Default pending-upload and failed-upload retention are each 24 hours, configurable by `PENDING_UPLOAD_RETENTION_HOURS` and `FAILED_UPLOAD_RETENTION_HOURS` (1–8,760 hours). Cleanup selects at most 100 rows per invocation, defaults to dry-run, and emits structured IDs/status/counts without credentials or signed queries. Apply mode is restricted to local/test; staging/production remains report-only pending a reviewed retention procedure.

Selection requires PENDING_UPLOAD/FAILED, age eligibility, no verified/finalized marker, no completed cleanup marker, no current Product version, and no job snapshot reference. Under row locks it rechecks eligibility and permits only exact UUID-scoped pending upload and unverified original keys. READY, historical verified media, current versions, and job-referenced sources are excluded. Abandoned pending intents become FAILED and receive a second grace-period sweep, covering outstanding upload signatures. Failed multipart sessions are aborted only for selected rows.

```powershell
cd C:\Data\ai-site\saas
npm run storage:cleanup                  # dry-run of configured local database/bucket
npm run storage:cleanup -- --test        # dry-run of explicitly configured test resources
npm run storage:cleanup -- --test --apply # apply only to selected eligible test staging rows
```

The isolated test ages six validation-failed staging rows beyond retention: dry-run preserves objects, apply removes their temporary keys, and a READY Product reference and valid source remain intact. Main customer/test buckets received no cleanup apply operation during this task. This phase provides the bounded command and policy; no recurring cleanup schedule or global bucket lifecycle deletion rule was installed.

## QA-27: fonts and favicon

The Google Fonts import was removed in favor of Segoe UI/Arial/system fallbacks. An app favicon was added. The existing CSP is retained. Local and remote Chrome/Edge checks report zero font CSP errors, and `/favicon.ico` returns 200.

## Validation

Commands run from `C:\Data\ai-site\saas` unless noted. The isolated runner invokes the actual existing npm scripts with a newly created database, private bucket/gateway, fake providers, and real inference credentials cleared; it does not change private host configuration.

| Command / check | Final result |
| --- | --- |
| `npm run test:unit` | PASS — 75/75 |
| `node tests/stabilization/run.mjs --suite integration` → `npm run test:integration` | PASS — 35/35; rerun after the final lock refinement |
| `node tests/stabilization/run.mjs --suite browser` → `npm run test:browser` | PASS — 41/41, including six browser journeys and integration tests |
| `npm run lint` | PASS — exit 0 |
| `npm run typecheck` | PASS — exit 0 |
| `npm run build` | PASS — exit 0; updated build running on 3200 |
| `python -m unittest discover -s tests -v` in `C:\Data\ai-site\worker-agent` | PASS — 74/74 |
| `node tests/stabilization/run.mjs --suite focused` | PASS — 6/6; relevant deterministic Tests 20, 21, 23, 25, 26, 27 plus the lock/pool regression |
| `node tests/stabilization/run.mjs --suite restart` | PASS — 6/6 real-process interruption cases; initial bounds fixture failed as described below |
| `node tests/stabilization/run.mjs --suite restart-bounds` | PASS — 1/1 corrected bounded-retry case |
| `node --import tsx tests/stabilization/reference-proof.ts` | PASS — external reference GET, 3,600-second TTL, no inference POST |
| `node --import tsx tests/stabilization/remote-checks.ts` | PASS — remote Chrome/Edge uploads/downloads, Content playback/download, reference validation, clean console/hydration |
| `node tests/stabilization/remote-html-diagnostic.mjs` | PASS — origin/edge HTML and strict CSP |
| `node tests/stabilization/secret-audit.mjs` and staged scope/whitespace review | PASS — zero secret/signed-query findings, ignored private env files, only Phase A staged, no whitespace errors |

Initial integration runs exposed a server-only import in workflow CLI admission and outdated synthetic multipart fixtures; both were corrected and the full integration suite rerun. Early focused tests used an incorrect Content media endpoint/response wrapper; the harness was corrected and rerun. The initial restart run passed all six process cases but its separate maxAttempts fixture omitted normal heartbeats between lost leases. The fixture now sends them; only that previously failed case was rerun and passes. These initial result files remain labeled in the evidence directory rather than being overwritten as successes.

The 41-test full browser run preceded the final lock-connection refinement; the six-test focused run, final integration rerun, fresh production build, and remote Chrome/Edge checks validate that refinement. Full validation uses the existing working tree, including preserved prior WaveSpeed changes; those prior changes are excluded from Phase A commits. Non-fatal Node development warnings about color variables and occasional socket listener counts appeared in suite logs; all listed checks pass and customer-browser console checks are clean.

## Paid operations, data, and security

This task made **0 real video inference calls, 0 real LLM/transcript-analysis inference calls, 0 Outreach sends, and 0 real payment operations**. Fake isolated jobs exercise token reservations/captures/releases without a billable provider call. WaveSpeed reference proofs use storage GET only.

Migration 0010 adds nullable validation/failure/cleanup markers without changing historical media lineage. Storage rotation preserved existing objects. Every isolated suite removed only its owned database, bucket, gateway, multipart uploads, and fixture mailbox files; cleanup results and fixture counts are recorded per run. Owned worker work directories and redacted logs remain ignored for diagnostics.

Remote validation runs created five preverified synthetic accounts/workspaces and owned Product references. Three static DIAGNOSTIC jobs published controlled Content without outbox/provider execution or token ledger entries. Fixture accounts are disabled, sessions revoked, and Products/Content archived; immutable fixture rows/objects remain for audit. Temporary proof upload keys in those owned workspaces remain subject to the retention command. Original customer media/history and unrelated rows were not deleted. The HTML comparison briefly reactivated only its retired owned fixture and restored its status without changing its password.

The final secret audit scans tracked text and staged blobs using configured private secret values, reporting categories only. It additionally rejects signed object URL queries in staged files. `.env.local` and worker private environment files remain ignored and untracked. No private environment, credential backup, temporary credential file, worker token, database/SMTP/provider secret, or signed URL query is included in Phase A commits. Browser response/bundle/console scans report zero secret findings. Nine pre-existing tracked modifications compare byte-for-byte equal to the initial snapshot and remain outside these commits.

## Remaining known defects and deferred work

| ID / phase | Remaining work |
| --- | --- |
| AUTH-001 | Remote signup email-verification delivery failure. Preverified QA accounts do not resolve this. |
| AUTH-002 | Signup text still mentions the local development mailbox. |
| WORKSPACE-001 | Missing create workspace/brand UI. |
| WORKSPACE-002 | Selector may become unclickable after a workspace switch until refresh. |
| BILLING-001 | Future account-level shared wallet migration. |
| PRODUCT-001 | Catalogue thumbnail/cover behavior. |
| PRODUCT-002 | Product creation Source/checklist changes. |
| PRODUCT-003 | Fixed reference slots. |
| PRODUCT-004 | Upload progress. |
| PRODUCT-005 | Same-reference replacement/current-version UX. |
| PRODUCT-006 | Unarchive Product. |
| AI-VIDEO-001 | Reopen active generation job when returning to AI Videos. |
| BILLING-UX-001 | Insufficient Token message/button UX. |
| Separate future phases | Shared account billing, Clipper Editing & Variations, Outreach SaaS, Phase 10. |

These findings were documented without implementation in Phase A. Real paid-provider restart behavior was not exercised; the production durability path was tested with actual processes and local media tools using fake analysis/transcription to preserve the zero-inference requirement.

## Exact files changed and Git scope

Only Phase A implementation, tests, evidence, and this report are committed. Nothing is pushed. Repository-relative paths below are rooted at `C:\Data\ai-site`; the final staged audit and documentation commit refresh `secret-audit.json` and add this report.

- `saas/.env.example`
- `saas/docker/staging-retention.mjs`
- `saas/docker/storage-gateway-config.mjs`
- `saas/docs/stabilization-phase-a-evidence/browser-run.json`
- `saas/docs/stabilization-phase-a-evidence/focused-before-lock-review.json`
- `saas/docs/stabilization-phase-a-evidence/focused-initial-run.json`
- `saas/docs/stabilization-phase-a-evidence/focused-run.json`
- `saas/docs/stabilization-phase-a-evidence/focused-second-run.json`
- `saas/docs/stabilization-phase-a-evidence/integration-before-lock-review.json`
- `saas/docs/stabilization-phase-a-evidence/integration-initial-run.json`
- `saas/docs/stabilization-phase-a-evidence/integration-run.json`
- `saas/docs/stabilization-phase-a-evidence/media-lock.json`
- `saas/docs/stabilization-phase-a-evidence/preservation.json`
- `saas/docs/stabilization-phase-a-evidence/remote-after-restart-initial.json`
- `saas/docs/stabilization-phase-a-evidence/remote-before-lock-review.json`
- `saas/docs/stabilization-phase-a-evidence/remote-before-restart.json`
- `saas/docs/stabilization-phase-a-evidence/remote-before-rule-correction.json`
- `saas/docs/stabilization-phase-a-evidence/remote-checks.json`
- `saas/docs/stabilization-phase-a-evidence/remote-html-before-rule-correction.json`
- `saas/docs/stabilization-phase-a-evidence/remote-html-diagnostic.json`
- `saas/docs/stabilization-phase-a-evidence/restart-analyzing_transcript.json`
- `saas/docs/stabilization-phase-a-evidence/restart-bounds-run.json`
- `saas/docs/stabilization-phase-a-evidence/restart-bounds.json`
- `saas/docs/stabilization-phase-a-evidence/restart-downloading_source.json`
- `saas/docs/stabilization-phase-a-evidence/restart-finalizing.json`
- `saas/docs/stabilization-phase-a-evidence/restart-initial-run.json`
- `saas/docs/stabilization-phase-a-evidence/restart-rendering.json`
- `saas/docs/stabilization-phase-a-evidence/restart-run.json`
- `saas/docs/stabilization-phase-a-evidence/restart-transcribing.json`
- `saas/docs/stabilization-phase-a-evidence/restart-uploading_results.json`
- `saas/docs/stabilization-phase-a-evidence/secret-audit.json`
- `saas/docs/stabilization-phase-a-evidence/storage-rotation.json`
- `saas/docs/stabilization-phase-a-evidence/test20.json`
- `saas/docs/stabilization-phase-a-evidence/test21.json`
- `saas/docs/stabilization-phase-a-evidence/test23-26-27-chrome.json`
- `saas/docs/stabilization-phase-a-evidence/test23-26-27-msedge.json`
- `saas/docs/stabilization-phase-a-evidence/test25.json`
- `saas/docs/stabilization-phase-a-evidence/verification-summary.json`
- `saas/docs/stabilization-phase-a-evidence/wavespeed-reference-proof.json`
- `saas/docs/stabilization-phase-a.md`
- `saas/migrations/0010_media_validation.sql`
- `saas/playwright.stabilization.config.ts`
- `saas/scripts/cleanup-pending.mjs`
- `saas/scripts/rotate-test-storage.mjs`
- `saas/scripts/storage-init.mjs`
- `saas/src/app/favicon.ico`
- `saas/src/app/globals.css`
- `saas/src/lib/assets.ts`
- `saas/src/lib/clipper.ts`
- `saas/src/lib/db.ts`
- `saas/src/lib/job-core.ts`
- `saas/src/lib/media-probe.ts`
- `saas/src/lib/operational-config.ts`
- `saas/src/lib/paid-operations.ts`
- `saas/src/lib/source-validation.ts`
- `saas/src/lib/sources.ts`
- `saas/src/lib/storage.ts`
- `saas/src/lib/worker-core.ts`
- `saas/src/lib/worker-messages.ts`
- `saas/tests/integration/clipper.spec.ts`
- `saas/tests/integration/remote-storage.spec.ts`
- `saas/tests/media-fixtures.ts`
- `saas/tests/stabilization/README.md`
- `saas/tests/stabilization/browser-checks.ts`
- `saas/tests/stabilization/focused.spec.ts`
- `saas/tests/stabilization/reference-proof.ts`
- `saas/tests/stabilization/remote-checks.ts`
- `saas/tests/stabilization/remote-html-diagnostic.mjs`
- `saas/tests/stabilization/restart.spec.ts`
- `saas/tests/stabilization/run.mjs`
- `saas/tests/stabilization/secret-audit.mjs`
- `saas/tests/stabilization/support.ts`
- `saas/tests/unit/operations.test.ts`
- `saas/tests/unit/stabilization-media.test.ts`
- `saas/tests/unit/stabilization-messages.test.ts`
- `saas/tests/unit/stabilization-retention.test.ts`
- `saas/tests/unit/stabilization-storage.test.ts`
- `worker-agent/clipper_executor.py`
- `worker-agent/clipper_pipeline/common.py`
- `worker-agent/tests/phase_a_fixtures/sitecustomize.py`
- `worker-agent/tests/test_stabilization_recovery.py`
- `worker-agent/worker_agent.py`
