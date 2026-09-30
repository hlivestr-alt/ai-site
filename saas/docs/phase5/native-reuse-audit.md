# Native Clipper read-only reuse audit

Inspected production checkout C:/Data/Clipper Ai Trends read-only: AGENTS.md, Phase 0 audit, transcriber.py (model loading/raw checkpoints/chunks/word normalization), moment_detector.py (brand prompt/validation/dedupe), ffmpeg_editor.py (imports, cut, captions, probe, process runner), clip_scorer.py, export_packager.py, config.py, model_manager.py, clipper_app/storage/transcripts.py (descriptor/registry/store), associated path/storage concepts.

No complete native module is imported directly by the SaaS worker. The pure timing helpers are safe in isolation, but their parent renderer imports native state; selected logic was therefore extracted into worker-owned modules.

| Component | Classification | Decision |
| --- | --- | --- |
| stdlib-only get_words_for_clip / timestamp helpers | SAFE TO IMPORT in isolation | Extract timing concepts into isolated caption writer; avoid importing parent renderer dependencies. |
| transcriber._run_faster_whisper_transcription | REQUIRES EXTRACTION | Minimal raw Faster-Whisper model/transcribe/segment/word loop copied and adapted. Generic language, no paths in metadata, subprocess ownership. |
| transcriber.transcribe / TranscriptArtifactStore | SAFE WITH ADAPTER in native context; DO NOT REUSE SaaS store | Existing entry point creates native ArtifactRegistry and attaches run refs. Retain checksum/config/schema fingerprint concept, replace authority with SaaS checkpoints. |
| ffmpeg_editor.cut_raw_clip / _probe_video | REQUIRES EXTRACTION | Reuse H.264/AAC cutting and ffprobe validation concepts; worker-owned paths/processes, vertical crop. |
| ffmpeg_editor._write_ass_file | REQUIRES EXTRACTION | Native writes global relative temp_ass, brand/font/highlight configuration and shared locks. Adapt selected-clip word timing into small isolated ASS implementation. |
| ffmpeg_editor full edit pipeline | DO NOT REUSE | Native assets/hook_text/whatsapp_media imports, NVENC semaphore, global highlight state and brand overlays exceed Phase 5 boundary. |
| moment_detector.detect_moments | DO NOT REUSE | Fixed PROYA/Indonesian-skincare prompt, LM Studio, local moment cache and brand content logic. Replace with generic versioned TranscriptAnalyzer. |
| clip_scorer.score_clip / compliance_checker | DO NOT REUSE | Native config fallback, local model calls, brand/product-specific compliance and sidecars. Candidate score is analysis score, not native final visual scoring. |
| export_packager / main manifest logic | DO NOT REUSE entry point | Native output tiers/affiliate delivery and local mutable publication. Reuse manifest/lineage concepts only; SaaS result/artifact validator is authority. |
| config.py / model_manager.py | DO NOT REUSE | D:/VOD, D:/output_clips, brand vocabulary and process-wide local model management. Explicit worker environment replaces them. |
| queues, API/bootstrap, SQLite, watched folders, Electron, Outreach | DO NOT REUSE | Never imported/called/submitted. |

Installed environment inspected: Faster-Whisper 1.2.1, Torch 2.11.0+cu128, WhisperX 3.8.6, local FFmpeg/ffprobe and existing cached large-v3-turbo. No native package/GPU/driver upgrades. Native checkout had pre-existing unrelated Creative Studio changes; a per-file SHA baseline was captured before implementation and compared at completion. No native source or database was edited. No production VOD/native queue was exercised.
