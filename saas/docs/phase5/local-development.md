# Local development and deployment

Prerequisites: existing isolated Postgres/S3 test services, Python 3.11+, compatible installed Faster-Whisper/model/CUDA or CPU, FFmpeg with libass, and ffprobe. Do not upgrade the native GPU/toolchain stack. requirements-clipper.txt documents the compatible runtime pin; use a separate venv only if needed.

Run from saas: npm run db:migrate; npm run storage:init; npm run dev; npm run dispatcher. Provision with npm run worker:admin -- create <name> CLIPPER_V1 1. Keep the one-time credential in private worker environment. Set SAAS_BASE_URL (HTTPS except loopback), WORKER_TOKEN, WORKER_MAX_CONCURRENCY=1, WORKER_WORK_DIR, CLIP_ANALYZER_PROVIDER=openai, OPENAI_API_KEY, OPENAI_CLIP_MODEL and transcription config. Agent: python worker_agent.py. No port is opened on worker PC.

Test commands: npm run test:unit; npm run test:browser; npm run test:schema-bootstrap; npm run test:restart; npm run test:video-restart; npm run test:clipper-acceptance; npm run lint; npm run typecheck; npm run build. Worker: python -m unittest discover -s tests -v. Browser test configuration explicitly enables fake analyzer and reserves CLIPPER_TEST_V1; customer UI labels local simulation.

Storage deployment must support S3-compatible multipart, ListParts and UploadPartCopy, private bucket policy, CORS GET/PUT/HEAD for the customer origin and lifecycle cleanup for abandoned pending/incomplete multipart. Server needs temporary disk and ffprobe for bounded artifact verification. Workspace authorization is always required before issuing source/artifact signed access.

Source default 10 GiB; clips 1–10, duration 10–90 seconds; 9:16 only; transcript JSON 64 MiB; plan JSON 20 MiB; output 256 MiB default/512 MiB hard ceiling. Change only versioned future policies after renderer/capacity verification.
