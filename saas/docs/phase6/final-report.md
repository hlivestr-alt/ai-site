# Phase 6 final report

Phase 6 implements durable Content publication, Content Library, saved execution lineage, human approval/rejection, private media, archive and variant registration in `C:/Data/ai-site/saas`. Pricing/tokens/wallets/payments, workflow execution, distribution and Outreach were not started. No worker-agent source changes are included.

## Migration and model

`0006_content_review.sql` adds ContentItems, immutable ContentVersions, ContentRelations and append-only ReviewDecisions. Supporting tables are a durable one-per-job publication outbox, exact reference AssetVersions for authorization/retention and independent poster tasks. The supporting tables each have a specific durability or ownership purpose; no payment tables are added.

Types are AI_VIDEO and CLIP. Statuses are Pending Review, Approved, Rejected and Archived. Initial publication creates v1/Pending Review. Current-version pointers are constrained to the same item/workspace and required at commit. Versions have composite workspace/job/artifact, Product/Version/Rule, SourceAsset and supporting-artifact foreign keys. An insert guard validates successful job/current attempt/READY result membership and exact SHA/size/MIME/geometry. `(workspace_id, artifact_id)` and item/version-number uniqueness protect publication identity. Versions, decisions, references and relations reject update/delete; item origin is immutable and normal hard delete is blocked. Published artifact identity/status changes and deletion of referenced artifacts/sources/assets are blocked.

Migrations 0001–0005 are unchanged. Clean bootstrap 0001→0006 passed. The existing Phase 5 local database upgraded successfully with migration 0006, as did the isolated acceptance database. Existing supported successful jobs receive durable publication intents.

## Publication and recovery

The server job-success trigger queues an intent; the dispatcher validates and publishes atomically under outbox/job locks. Browser polling reads links only. AI Video maps one authoritative READY MP4 to one item/version. Clipper maps each selected MP4 to an item/version; transcript and plan JSON remain support lineage. Artifact selection excludes LOST, PENDING, FAILED and non-result outputs. Plan/transcript/source/input identities and selected clip metadata are checked before publication.

Ten concurrent publication calls for the primary AI Video fixture returned one item/version; ten for the two-clip fixture returned two items/versions. Repeated publication returns existing artifact identities, writes no duplicate audit/media and does not submit or render again. A temporary failure rolls back publication, retains Pending intent and retries after bounded backoff without changing SUCCEEDED job state.

The recovery test forced ContentVersion insertion to fail after a fake-provider success, leaving zero partial Content. It restarted the SaaS app and the dispatcher process, removed the failure and recovered exactly one item/version. The same job, attempt, provider execution, READY artifact ID/size/SHA and single provider submission survived. Ten concurrent replays after recovery still returned the same item. Separate Phase 3 and Phase 4 restart regressions also passed.

## Lineage and versions

AI Video retains exact frozen Product/Rule versions, reference AssetVersions, policy/tier/aspect ratio, input hash, execution and artifact identity. The historical hard gate updated Product v1 to v2 and replaced its reference after job success but before publication. API and Chrome review showed the original v1 text/image bytes; requesting the replacement image as a historical reference returned 404.

Clip items retain exact source ID/SHA, transcript/plan IDs/fingerprint, clip spans/hook/reason/score/tags, optional frozen Product snapshot, analyzer/render/pipeline policy and artifact checksum. The primary fixture's two selections begin at 0 and 15 seconds and share the correct source/transcript/plan. Generic clip review shows the original authorized source video beside the output. Internal analyzer/provider metadata is not projected into normal customer detail.

Separate items can be registered as variants of one existing active same-workspace parent. Self-links/cycles, foreign parents and excessive ancestry are blocked; retries of the same edge are idempotent. Relations are immutable and workspace-serialized with a 64-ancestor traversal limit. The UI records lineage only and generates no new video.

A supplemental trusted-database test appended v2 from another successful fake job, switched the current pointer and verified Pending Review with v1's approval history preserved. Stale v1 review returned 409. The approval helper returned false for v1 and unreviewed v2, true only after v2 approval, then false after archive. The item retains its original job separately from its current version's execution. No customer version-write/regeneration endpoint is exposed.

## Library and Review Center

Library uses real workspace items, private posters/placeholders, type/status/Product filters and bounded plain-text search over title/hook, frozen Product name, source filename and type. Search is capped at 100 characters and parameterized with literal wildcard escaping. Pages are 24 items, ordered by creation date/ID descending, with page bounds 1–500. Product filter options cap at 200. Default views and counts exclude Archived. Home shows actual Content Assets and Pending Review alongside existing workspace/job counters.

Review Center is the same model filtered to Pending Review. Detail includes native private video, exact saved context, source/clip details, review timeline and lineage/job/parent/variant links. Successful AI Video and Clipper job pages link back to their published items. Empty views are truthful. Archive preserves history/lineage/media and permits direct authorized detail/preview while blocking the Content download route. There is no hard deletion or unarchive UI.

Owner/Admin/Editor can approve/reject/archive/register variants/retry posters; Viewer reads without mutation controls and receives 403 for writes. Reject requires a type-appropriate category and optional readable text up to 1,000 characters. Generic categories are BAD_CLIP_SELECTION, CAPTION_ISSUE, QUALITY_ISSUE, OTHER; Product-backed content also permits six Product-accuracy categories. Later re-review is allowed and appends history. Accepted decisions update status/revision and write safe-ID/category audit events atomically.

Identical concurrent requests with one key produce one decision and idempotent success responses. Different concurrent decisions using the same expected revision produce one success and one 409; stale version/revision or reused-different-payload keys also return 409. The current status is version-scoped. `isContentApproved` checks workspace, current version, status and matching approval-history revision; it is ready for future authorized downstream callers.

## Media and retention

Videos use their existing sealed private objects with no duplicate binary copies. All output/source/reference/poster signing requires workspace/item/version authorization and matching lineage. URLs expire after five minutes, refresh in memory every four minutes and can be refreshed after player errors. Downloads use a sanitized human-readable MP4 filename. Raw keys, credentials, provider internals and signed tokens are not rendered in customer detail or written to Content/audit records.

The chosen QA matrix allows all members, including Viewer, to preview and download any non-archived workspace Content. This preserves Phase 4/5 job artifact access and avoids inconsistent restrictions between Job and Content routes. Approval separately determines future downstream eligibility. Archived Content downloads return 409; historical job downloads keep their existing membership policy. A stricter Viewer policy would need coordinated changes to both surfaces. Issued signed URLs are temporary bearer capabilities; another workspace cannot obtain them through APIs, but a recipient of an already-issued URL can use it until expiry. Unsigned objects are denied.

Posters are private server-owned JPEGs with checksum/type/size. CPU FFmpeg extracts one frame into a 480×480 bound, with a 15-second process timeout, 512 MiB input bound and 1 MiB output bound. Downloads check SHA/size and elapsed time between stream chunks. Work has three-minute claim expiry, attempt fencing, three bounded attempts and an editor retry for failed posters. Poster failure leaves Content usable with a placeholder. Production stalled-network timeout/supervision and poster throughput remain deployment concerns.

All ContentVersions, including archived history, retain outputs/transcript/plan/source/reference identities through foreign keys. Existing cleanup only removes abandoned pending Product upload staging. No automatic sealed-media/source deletion is added; production bucket lifecycle must respect retention. Direct storage-admin deletion can bypass database retention and return unavailable media. Failed/stale poster attempts can leave unreferenced objects; no new garbage collector is introduced.

## Isolation and acceptance

Primary Chrome acceptance published **1 AI Video item and 2 Clip items**, each with one initial version, with **2 approvals and 1 BAD_CLIP_SELECTION rejection** before deliberate later re-review/concurrency/archive checks. Chrome loaded output and original source media, displayed historical Product references, approved/rejected, reloaded persistent history and downloaded both approved AI Video and Clip MP4s. The downloaded AI Video SHA matched its ContentVersion. Library posters were extracted and visually checked.

Workspace A's initial counts were 3 assets / 0 pending / 2 approved / 1 rejected; new B counts were all zero. Type/status/search/Product and bounded pagination were checked. Brand B substituted A workspace/item/version IDs for detail/history, output/download/poster/source/reference, review/archive and relations and was denied. A child linked to a real B parent failed through both API and database. Foreign version pointers/lineage and wrong checksums were rejected. Viewer read/download and mutation denial were checked. Self/cycle rejection, append-only history, artifact/source retention, poster failure/retry and archive behavior passed.

Supplemental acceptance used three fake AI Video jobs to test replacement v2 and a real foreign parent: one A item with two versions and one B item. Restart acceptance used one additional fake AI Video job/item/version and one submission. These are isolated test fixtures, not production content totals. Repeated regression runs create separate test workspaces; no total across that accumulated test database is presented as customer assets.

## Validation

| Check | Result |
| --- | --- |
| TypeScript unit tests | 11 passed |
| Unchanged Python worker tests | 10 passed |
| Phase 6 integration/Chrome tests | 3 passed, including in the final full suite |
| Existing Phase 1–5 integration/browser regressions | All 13 passed in the final full suite |
| Full Phase 1–6 integration/browser suite | 16 passed (6.1 minutes); the earlier added-test read connection reset was resolved with a bounded read retry and all checks reran successfully |
| Clean migration bootstrap 0001→0006 | Passed |
| Existing Phase 5 database upgrade | Passed |
| Phase 3 app/dispatcher/worker restart | Passed; LOST attempt fenced, late callback denied, successful retry |
| Phase 4 fake-provider app/dispatcher restart | Passed; one submission, one READY artifact |
| Phase 6 publication failure/app/dispatcher process restart | Passed; same job/artifact, one item/version, ten replay calls |
| ESLint | Passed |
| TypeScript typecheck | Passed |
| Production build | Passed; Content, Review and workspace APIs compiled successfully |
| Old migrations / workspace scope / whitespace | Verified unchanged / SaaS-only changes / passed |

Ignored `saas/data/phase6` contains acceptance/version/restart JSON, bootstrap/upgrade/unit/worker/browser/restart/static/build logs, credential-presence booleans, native hash comparison and Chrome screenshots. No test credentials, signed URL dumps or generated media are added to Git. All owned acceptance helper processes are stopped on completion. The ten requested Phase 6 documents plus this report are provided.

## Phase 7 handoff and external gates

Stable ContentVersion → Job/type/input hash → execution/attempt/usage → artifact/result identities are available for future ledger joins. Phase 7 can attach reservation/capture/release/refund to Jobs without rewriting Content, and must not treat publication/review/poster/variant retries as another generation. No ledger/payment logic is implemented. Approval eligibility is explicit and reusable; downstream execution is not added.

Remaining production work includes supervised dispatcher/poster service capacity, FFmpeg availability, storage lifecycle/CORS/backups and production provider/network acceptance. Library offsets can shift when newer rows arrive; detail history/versions/relations display at most 100 each; variant parent selection offers the newest 24 active items. All older history stays stored.

| External acceptance | Status |
| --- | --- |
| BytePlus credential configured in inspected SaaS/worker/process config | **NO** |
| Real Seedance acceptance still pending | **YES** |
| OpenAI analyzer credential configured in inspected SaaS/worker/process config | **NO** |
| Real OpenAI analyzer acceptance still pending | **YES** |

These are separate external-provider gates and do not fail Phase 6 acceptance. No real provider request was attempted.

## Safety

| Item | Changed / triggered during Phase 6 |
| --- | --- |
| Internal AI Site | **NO**; repository changes are confined to `saas` |
| H3 Bridge | **NO** |
| Creative Studio | **NO** |
| Native Clipper | **NO**; 0 changed/missing files across 2,572 tracked-file SHA comparisons |
| Native Clipper DB/schema | **NO** |
| Outreach | **NO** |
| Native Outreach DB | **NO** |
| Private worker-agent source | **NO** |
| Real Seedance generations | **0** |
| Real OpenAI analyzer calls | **0** |
| New real Faster-Whisper transcriptions | **0** |
| Native production Clipper jobs | **0** |
| Outreach campaigns | **0** |
| Creator messages | **0** |
| Payments | **0** |

Stopped after Phase 6. Phase 7 is not begun.
