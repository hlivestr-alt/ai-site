# Private Windows Worker Agent (Phase 3 fixture)

This Python 3.11+ process calls the SaaS API outbound. It opens no listening port and does not import or run the native Clipper, FFmpeg, AI services, or providers. Its only executor is deterministic `SYSTEM_TEST` work.

1. In `saas`, run `npm run worker:admin -- create local-fixture SYSTEM_TEST 1`. Copy the returned credential once into this project's ignored `.env`, based on `.env.example`. Do not commit or log it. `worker:admin rotate <worker-id>` revokes previous credentials and prints one new credential.
2. Start the SaaS app, Postgres/storage Compose services, and `npm run dispatcher` in a separate terminal.
3. In `worker-agent`, run `python worker_agent.py` from a normal Windows terminal. `python worker_agent.py --once` processes currently available work and exits. Run `python -m unittest discover -s tests` for agent tests.

The agent heartbeats every 20 seconds, claims only its provisioned capabilities, renews each lease before progress, reports monotonic progress, and sends a deterministic SHA-256 result. The server verifies the current lease and fencing token on every callback. Stop with Ctrl+C to drain; no Windows startup task is installed. The agent creates `data/jobs/<job-id>/<attempt-id>/receipt.json` for each attempt. These directories are retained for diagnostics and should be removed manually only after the Job reaches a definitive terminal state and any operational retention requirement is met.

For production, use HTTPS and a separate secret manager/service installation plan. The local `http://127.0.0.1:3200` exception works only when the agent and SaaS preview share the same machine. A future Clipper executor must be added in a later phase behind explicit capability and isolation review.
