# Phase 5 completion report — September 30, 2026

The private source → SaaS CLIPPER job → Windows worker → local transcription → analysis → local rendering → private result path is implemented. One controlled real local job produced two captioned clips and recovered from a worker restart using its durable transcript. OpenAI production analysis is implemented; its real acceptance is blocked by the missing credential. Phase 6 has not begun.

## Native Clipper reuse

Read-only inspection covered `transcriber.py`, `moment_detector.py`, `ffmpeg_editor.py`, `clip_scorer.py`, `export_packager.py`, `config.py`, `model_manager.py`, `clipper_app/storage/transcripts.py`, and associated configuration/path/registry code. The [module/function audit](native-reuse-audit.md) records every classification.

No complete native module is imported directly. Pure word/timestamp helpers are safe in isolation, but their renderer parent imports native dependencies. Minimum processing logic and concepts were extracted into the worker package: the Faster-Whisper model/segment/word loop from `_run_faster_whisper_transcription`; H.264/AAC cutting and ffprobe validation from `cut_raw_clip`/`_probe_video`; relative selected-clip caption timing from `get_words_for_clip`/`_write_ass_file`; and checksum/config/schema fingerprint concepts from canonical transcript artifacts. Paths, process ownership, cloud checkpoints and manifests use SaaS adapters.

Deliberately excluded: native transcript registry/SQLite, queues, watched folders, native API/Electron/bootstrap, global output/ASS directories, native model manager, full editor overlays/WhatsApp dependencies, PROYA moment prompts, LM Studio, product-specific compliance/scoring and affiliate export packaging. WhisperX is installed but excluded from the initial path because native alignment adds global patches/orchestration.

Native Clipper files changed: **NO**. SHA-256 comparison against the initial baseline found **0 changed files among 2,572 tracked files**. Pre-existing unrelated native checkout edits were preserved. Native DB/schema/queue were never written or invoked. No CUDA, Torch, Whisper, FFmpeg or driver upgrade occurred. This verification establishes source preservation; a native production VOD was intentionally not queued as a smoke test.

## Migration and source upload

`0005_clipper.sql` adds workspace-owned `source_assets`, immutable source identity/checksum protection, bounded probe metadata, `workers.clipper_health`, and `clipper_checkpoints` with composite workspace/job/artifact foreign keys. Migrations 0001–0004 remain unchanged. The JSON ceiling rises only for the `transcript` slot to **64 MiB**; other JSON remains **20 MiB**, and the existing video hard ceiling remains **512 MiB**.

Sources are separate from Product Assets. Lifecycle: `PENDING_UPLOAD → UPLOADED → VERIFIED`, with failure/retirement states. Default `MAX_CLIPPER_SOURCE_BYTES` is **10 GiB**, configurable up to **100 GiB**. MP4 is the initial supported source container; verified duration is under 24 hours and dimensions at most 16384.

Files ≤64 MiB use direct signed PUT. Larger files use S3 multipart with 64 MiB parts, individual part retry, storage-backed part listing, exact contiguous-part/size completion, and browser resume handles. No source bytes pass through Next.js memory. A **69 MiB synthetic multipart upload** exercised missing-part rejection and resume without resending the completed part.

Server-generated paths are `pending/workspaces/<workspace>/sources/<source>/upload` and sealed `workspaces/<workspace>/sources/<source>/original`. Finalization verifies size/MIME/MP4 signature and copies staging under its ETag condition to a private key never signed for PUT. Copy above 5 GiB uses multipart server-side copy. Replaying a staging upload URL cannot change the sealed source. Multipart ETag is never a SHA-256 surrogate. The first authenticated leased worker streams the entire source, calculates SHA-256, probes it, and pins the verified digest; future attempts compare it. Sources are reusable within their workspace.

## Job and customer controls

CLIPPER has `schemaVersion:1`, `kind:"CLIPPER"`, a frozen `SOURCE_ASSET` identity, optional frozen Product version/rules/text, language, goal, clip count, duration bounds, captions and policy versions. Server-only object keys are removed by `safeWorkerInput`; Product binaries are excluded. Generic clipping requires no Product.

Controls are language Auto or supported values, goal up to 1000 characters, **1–10 clips**, integral minimum/maximum **10–90 seconds**, captions On/Off and fixed **9:16**. The existing workspace/type/idempotency contract returns one job for concurrent identical submissions and 409 for changed input under the same key. History shows real source/Product/status/requested/found/created/finished values. Results show safe selection metadata, private playable clips, transcript/plan downloads and attachment downloads. Signed URLs are short-lived and refreshed; they are not persisted in results. Viewer can read permitted results, while upload/submit/cancel use existing role permissions.

## Worker and transcription

Production capability is `CLIPPER_V1`; explicit local simulation requires the separate `CLIPPER_TEST_V1`. A fixture-only worker cannot claim production Clipper work. Python dispatch preserves SYSTEM_TEST and adds `ClipperExecutor`/`ClipperPipeline`; AI_VIDEO remains server/provider-owned. Clipper concurrency is **one active job per worker**, including generic two-slot workers. Different workers can process different jobs concurrently.

Attempts use validated UUID paths under `data/jobs/<job>/<attempt>/{source,transcript,analysis,render,outputs,logs}`. Every source/checkpoint/output/progress/completion operation carries worker bearer identity plus current attempt, lease and fence. The worker opens no inbound port and holds no SaaS DB/object-store credential. A separate renewal thread runs at most 10 seconds apart during downloads, model work, analyzer calls, rendering and uploads. Expiry/fencing stops unsafe mutations; cancellation stops only owned children and prevents new stages/uploads.

Disk precheck reserves twice source bytes + clip output allowances + 1 GiB and observes a configurable local job budget, default 40 GiB. Low space returns `WORKER_DISK_SPACE_LOW`. Large local files are deleted only after verified cloud success; hourly retention cleanup confirms authoritative terminal state before deleting old attempt directories. Interrupted/requeued jobs retain recovery material.

Real transcription used installed **Faster-Whisper 1.2.1**, cached **large-v3-turbo**, **CUDA float16**, VAD and word timestamps. No WhisperX alignment or cloud transcription was used. Schema-v3 JSON contains duration/language, timed segments/words and implementation/model/config/schema metadata, without Windows paths. Reuse requires source SHA plus complete transcription config/package/model revision/schema fingerprint, within the same job; no shared customer/native transcript store is used.

## Transcript analyzer and selection

The provider-neutral `TranscriptAnalyzer.analyze` accepts timestamped chunks, transcript version/language, optional Product text, customer goal, duration bounds and policy. Fake analysis is deterministic and passes through the same validation/ranking/render path.

OpenAI uses the current official Responses API `text.format` strict JSON schema, `store:false`, a 4000-output-token cap and bounded response parsing. The [official Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) was checked before implementation. A worker-local `OPENAI_API_KEY` and explicit `OPENAI_CLIP_MODEL` are required; no model was guessed or configured for acceptance. Secrets are absent from input, artifacts, heartbeat and logs. Future provider-secret centralization/rotation remains an operational handoff.

Policies are `clip-selection-v1` and `vertical-h264-v1`. The analysis policy is generic, treats supplied text as untrusted data, and contains no native brand assumptions or implicit provider fallback. Chunks retain absolute times, nominal 300-second windows, 90-second overlap and a 16000-character budget, bounded to 256 chunks and 20 candidates per chunk. A single long segment can exceed the nominal time window; oversized text fails safely.

Validation rejects negative/reversed/out-of-source timestamps, bad duration, nonfinite/out-of-range scores, oversized text/tags and malformed fields before FFmpeg. Selection uses bounded speech-boundary snapping, timestamp-overlap dedupe, global score/goal relevance/diversity ranking, and returns up to the requested number without fabricating moments. The private schema-v1 plan persists source/transcript/input identity, policy/provider/model, candidate counts, selected clips and usage. Internal usage metadata is retained for later accounting; no customer charges were added.

## Rendering and artifacts

Local FFmpeg produces **720×1280, 30 fps, H.264 libx264 veryfast CRF23, yuv420p, AAC 128k, faststart** MP4 with center-fill crop. Captions use real selected-clip speech timing in isolated ASS files; text/control escaping and relative timing are tested. Both real clips were played in Chrome, and a decoded frame was inspected for readable captions.

Each output defaults to a **256 MiB** cap, hard ceiling **512 MiB**, with bounded process timeout/size. Local and server ffprobe verify geometry, codec and duration; SHA-256 verifies bytes. Approved slots are `transcript`, `clip-plan`, and `clip_001…clip_010`. Server seals staging objects, checks hashes/schema/lineage/media, then rechecks the current lease after I/O before READY. Completion requires every declared artifact to be READY in the current attempt and every clip to match the sealed plan. SYSTEM_TEST's original artifact-count/size contract is retained.

Result metadata includes artifact IDs, start/end/duration, score/hook/reason/tags, dimensions/checksum and lineage/version fields. Workspace authorization and successful-result membership are required before signing previews/downloads. The browser download used an actual Chrome download event; saved bytes matched the result SHA.

## Recovery

Durable stages are source verification and sealed transcript/plan/output checkpoints under the immutable job input hash. Local validated stage files and upload receipts additionally avoid recomputation during bounded stage retries. A new fenced attempt can download compatible cloud checkpoints, republish into its own approved slots and rebind plan transcript identity. Lost-attempt artifacts are never accepted directly as current-attempt completion.

Transient source/analyzer/upload failures are bounded; jobs have at most three attempts. Invalid input/plan/media, missing local model/tooling and low disk require intervention. Successful analyzer chunks are cached locally; a durable plan skips analysis. Upload failure tests show one transcript/analysis/render despite an initial failed upload. Partial renders are not accepted. Late progress/source/output/finalization/completion are rejected after fencing; successful completion is idempotent. A provider response lost before checkpoint can be retried, so external paid calls do not have an exactly-once guarantee.

## Acceptance

Controlled job: `be9ceb27-b431-4c7b-a3a3-ba65a4691610`, workspace `0250c3c4-d87c-44c1-9d8e-aa5dee94a554`, isolated test database/private bucket, synthetic 485565-byte, 57.47-second source.

| Measure | Result |
| --- | --- |
| Real local transcription runs | **1** |
| Real local render jobs | **1** |
| Rendered clips | **2** |
| Fake-analyzer jobs in real local acceptance | **1** |
| Real OpenAI analyzer calls | **0** |
| Customer page/browser closure | Passed; no customer page remained open while the worker ran |
| Next.js restart during active job | Passed; authoritative job persisted |
| Dispatcher restart | Passed |
| Worker restart | Passed; first attempt LOST, second SUCCEEDED |
| Transcript checkpoint reuse | Passed; second attempt transcribed zero times |
| Late completion | Rejected 409 |
| Chrome playback/download/refresh/history | Passed; two real previews and checksum-matched download |
| Cross-workspace source/job/transcript/plan/clip access | Rejected, including substituted IDs |
| Concurrent duplicate submit | One job; changed request returned 409 |
| Viewer | Permitted results; upload/submission/cancel denied |

Early browser-driver locator/stage-case errors were corrected, and acceptance resumed the same controlled job. Subsequent browser verification re-read completed results and did not create another real pipeline job. Expensive stage totals above come from persisted execution counters across both attempts. Deterministic API contract tests use small prebuilt artifacts and are separate from these real execution totals.

## OpenAI acceptance and Phase 4 status

OpenAI credential configured: **NO**. OpenAI model configured: **NO**.

**REAL OPENAI ANALYZER TEST BLOCKED — OPENAI API KEY REQUIRED**

No paid analysis was attempted, and no LM Studio/PROYA fallback exists. This does not block the completed local/fake-analyzer acceptance.

BytePlus credential configured: **NO** in the inspected SaaS/worker/process configuration. Phase 4 provider code/architecture is unchanged. Its fake-provider restart regression still submits exactly once. Real Seedance generations triggered during Phase 5: **0**. Real Phase 4 BytePlus acceptance remains pending separately.

## Validation

Evidence is kept in ignored `saas/data/phase5`, including `acceptance.json`, restart/unit/worker/schema/lint/typecheck/build logs, native hash comparison, credential-presence booleans and Chrome screenshots. No credentials or signed URL dumps were committed.

| Check | Result |
| --- | --- |
| TypeScript unit | 7 passed |
| Python worker | 10 passed |
| Full Phase 1–5 integration/browser suite | 13 passed, including the 3 new Clipper tests |
| Controlled real Chrome/local pipeline | Passed |
| Phase 3 app/dispatcher/worker restart | Passed |
| Phase 4 app/dispatcher restart, fake provider | Passed; one submission/one artifact |
| Migration clean bootstrap 0001→0005 | Passed |
| Existing Phase 4 database upgrade | Passed |
| Old migrations unchanged | Verified |
| ESLint | Passed |
| TypeScript typecheck | Passed |
| Production build | Passed |
| Git whitespace check | Passed |

## Phase 6 handoff and remaining deployment work

Stable lineage is SourceAsset ID/SHA → immutable job input hash/settings/optional Product snapshot → schema-v3 transcript artifact/fingerprint → schema-v1 plan/transcript ID/provider/model/policies → successful current-attempt READY clip artifact IDs/hashes/geometry. Result schemaVersion 1 exposes source/transcript/plan/artifact identities and versions. Future Content Library/Review can reference those immutable IDs; lost-attempt checkpoints are not published content. `READY_JOB_ARTIFACT` should become a separately authorized future source-union branch.

Remaining production acceptance: configure an explicit supported OpenAI model/key and run its controlled test; verify the chosen production S3 provider's multipart/CORS/lifecycle behavior and >5 GiB server-side copy. Local multipart/resume is tested; a multi-hour/multi-GB production VOD and production cloud deployment were not exercised. Normal service installation, provider-secret rotation, retention/lifecycle operations and backups remain deployment responsibilities. No ContentItem/review/approval/variants, workflow engine, token wallet or billing functionality was implemented.

## Safety

| Item | Changed / triggered during Phase 5 |
| --- | --- |
| Internal AI Site | **NO**; changes are scoped to `saas` and `worker-agent` |
| H3 Bridge | **NO** |
| Creative Studio | **NO** |
| Native Clipper | **NO** |
| Native Clipper DB/schema | **NO** |
| Outreach | **NO** |
| Native Outreach DB | **NO** |
| Real Seedance generations | **0** |
| Native production Clipper queue jobs submitted | **0** |
| Outreach campaigns | **0** |
| Creator messages | **0** |
| Payments | **0** |

Stopped after Phase 5.
