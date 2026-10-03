# Private Windows Worker Agent

This Python 3.11+ process calls the SaaS API outbound and opens no listening port. It retains the deterministic SYSTEM_TEST executor and adds a worker-owned headless CLIPPER executor with local Faster-Whisper, explicit transcript analysis and local FFmpeg. It never imports the native Clipper queue/database or executes AI_VIDEO.

1. In `saas`, run `npm run worker:admin -- create local-fixture SYSTEM_TEST 1`. Copy the returned credential once into this project's ignored `.env`, based on `.env.example`. Do not commit or log it. `worker:admin rotate <worker-id>` revokes previous credentials and prints one new credential.
2. Start the SaaS app, Postgres/storage Compose services, and `npm run dispatcher` in a separate terminal.
3. In `worker-agent`, run `python worker_agent.py` from a normal Windows terminal. `python worker_agent.py --once` processes currently available work and exits. Run `python -m unittest discover -s tests` for agent tests.

The agent heartbeats every 20 seconds and claims only its provisioned capabilities. SYSTEM_TEST renews before progress, reports monotonic progress, and sends a deterministic SHA-256 result; CLIPPER renews independently throughout long processing. The server verifies the current lease and fencing token on every callback. Stop with Ctrl+C to drain; no Windows startup task is installed. The agent creates `data/jobs/<job-id>/<attempt-id>/receipt.json` for each attempt. Small fixture receipts remain for diagnostics. Clipper removes large stage files after verified success; its retention sweep checks authoritative terminal state before removing older attempt directories.

For production, use HTTPS and a separate secret manager/service installation plan. The local http://127.0.0.1:3200 exception works only when agent and SaaS share the same machine.

Clipper provisioning: npm run worker:admin -- create <name> CLIPPER_V1 1. Configure the installed Whisper model, CLIP_ANALYZER_PROVIDER=openai, OPENAI_API_KEY and OPENAI_CLIP_MODEL in the private worker environment. A separate background renewal loop protects long jobs; server caps Clipper concurrency at one per worker. Large local files are cleaned after verified cloud completion. Old interrupted attempts require an authorized terminal-state check before cleanup. Fake analysis requires explicit local mode and separately provisioned CLIPPER_TEST_V1.

See [Phase 5 development](../saas/docs/phase5/local-development.md), [pipeline](../saas/docs/phase5/worker-pipeline.md), and [recovery](../saas/docs/phase5/checkpoints-and-recovery.md). Run python -m unittest discover -s tests -v for both executors.

WaveSpeed analysis is also supported: set CLIP_ANALYZER_PROVIDER=wavespeed with private WAVESPEED_API_KEY, WAVESPEED_LLM_BASE_URL=https://llm.wavespeed.ai/v1, and exact WAVESPEED_CLIP_MODEL=openai/gpt-5.6-luna. Match the SaaS provider/model; jobs freeze the model and workers reject mismatches. Run `python wavespeed_smoke.py --env .env` for one small controlled request after authenticated model availability checking. Direct OpenAI remains supported. See [provider operations](../saas/docs/wavespeed-providers.md).
