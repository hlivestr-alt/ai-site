# Phase 5: private source to private clips

Phase 5 adds SourceAssets and CLIPPER jobs to the existing Postgres job/lease system. The Windows agent downloads a sealed source, transcribes locally, analyzes timestamped text, selects moments, renders locally, and publishes verified private artifacts. The browser can close. No inbound worker service, native queue, SQLite authority, payments, workflow engine, or Content Library is introduced.

Read [source assets](source-assets.md), [jobs](clipper-jobs.md), [native reuse audit](native-reuse-audit.md), [pipeline](worker-pipeline.md), [transcription](transcription.md), [analyzer](transcript-analyzer.md), [OpenAI](openai-analyzer.md), [selection](clip-selection.md), [rendering](rendering.md), [recovery](checkpoints-and-recovery.md), [isolation](isolation-tests.md), [local development](local-development.md), and [Phase 6 handoff](phase6-handoff.md). Actual acceptance evidence is recorded in [final report](final-report.md).

Migration 0005 applies after unchanged 0001–0004. Phase 4's BytePlus adapter and policy are unchanged. A missing Seedance credential does not affect Clipper.
