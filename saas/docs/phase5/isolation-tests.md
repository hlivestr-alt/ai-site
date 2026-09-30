# Isolation and acceptance evidence

tests/integration/clipper.spec.ts covers SourceAsset authorization, substituted workspace/source/job/artifact IDs, source reuse, concurrent idempotency, changed input 409, safeWorkerInput, scoped source GET, verified checksum, transcript/plan/clip slots, multiple outputs, plan matching, immutable sealed outputs under old signed PUT replay, Viewer read/create/cancel, multipart resume and missing-part rejection, two-worker capacity, cancellation and stale completion/progress.

Worker unit tests cover fake/OpenAI structured provider contract, chunk coverage/budgets/overlap, invalid timestamps/score/text/tags, global dedupe/ranking, captions, no provider fallback and upload-failure local checkpoint recovery. Existing Phase 1–4 tests remain part of the regression suite.

tests/clipper-acceptance.mjs drives real installed Chrome: Owner uploads synthetic MP4 through the form, submits a job, closes page, real worker transcribes, app/dispatcher restart during work, controlled worker stops after durable transcript, lease expires, next attempt restores transcript, renders captioned clips, old completion is rejected, page returns with actual private previews/downloads and refresh-persistent history. tests/pause_after_transcript.py is an acceptance-only monkeypatch, not a production worker flag.

Runtime evidence and screenshots are in ignored saas/data/phase5. Final report names counts and any failures/blockers; automated contract fixtures are synthetic and under 0.6 MiB each.
