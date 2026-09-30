# Phase 6: Content Library and human review

Successful AI Video and Clipper outputs now become reusable Content with immutable execution lineage, private media, append-only review decisions and variant relationships. Content is metadata over sealed JobArtifacts; publishing does not copy or generate another video.

Read [model](content-model.md), [publication and recovery](content-publication.md), [lineage](content-lineage.md), [Library](content-library.md), [Review Center](review-center.md), [decisions](review-decisions.md), [media and retention](media-access.md), [acceptance tests](isolation-tests.md), and [Phase 7 handoff](phase7-handoff.md). The [final report](final-report.md) records actual validation and safety results.

Apply `npm run db:migrate` before starting the upgraded app and `npm run dispatcher`. Migration 0006 enqueues existing successful supported jobs. The dispatcher publishes pending intents and extracts small private JPEG posters with CPU FFmpeg. `FFMPEG_PATH` can select the installed executable; a missing executable leaves usable Content with placeholders and a retry action.

There is no customer publication endpoint. Operators can run `npm run content:reconcile` for a bounded batch, or append a workspace UUID and job UUID to repair one authoritative publication. The command uses the configured server database/bucket. Keep it behind operator access; it is not a customer API.

Development acceptance uses the isolated test database/bucket, explicitly enabled fake video provider and existing MP4 fixtures. No new transcription, real analyzer, Seedance generation, native production queue or payment is required. No worker-agent code changes are part of Phase 6. Stop here: pricing, tokens, wallets, payments, workflow execution and distribution remain later work.
