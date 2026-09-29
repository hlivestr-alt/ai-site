# Local development and acceptance

1. Set the SaaS `.env.local` from `.env.example` and set a random 32+ character `DEV_DIAGNOSTIC_TOKEN`. Start the existing Postgres and S3-compatible Compose services. Run `npm run db:migrate` and `npm run storage:init` in `saas`.
2. Run the SaaS app (`npm run dev -- -p 3200`) and the independent dispatcher (`npm run dispatcher`) in separate terminals.
3. Provision a fixture worker with `npm run worker:admin -- create local-fixture SYSTEM_TEST 2`. Copy the one-time token into `../worker-agent/.env` based on its example. Start `python worker_agent.py` in that directory.
4. An OWNER/ADMIN may enqueue a diagnostic Job via same-origin `POST /api/dev/fixture-jobs` with the diagnostic header, workspace ID, idempotency key, steps, and delay. The route exists only when `APP_ENV=local`; it does not appear in normal customer UI. Visit `/jobs` to inspect status.

Check migrations with `npm run db:status`; `npm run test:schema-bootstrap` creates a temporary database, applies 0001–0003, verifies them, then removes only that temporary database. Run SaaS validation with `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`; run `python -m unittest discover -s tests` in `worker-agent`. `tests/integration/jobs.spec.ts` covers idempotency, concurrent claims, stale callbacks, retry, and workspace isolation. `tests/browser/jobs-journey.spec.ts` closes the browser, runs ten fixture Jobs with bounded worker capacity, then reopens it. Run `npm run test:restart` while no other process owns port 3200; it starts and stops its own Next.js and worker processes against the test database.

Do not install a Windows startup task automatically. After terminal execution is verified, a later deployment plan may use a Windows service and HTTPS SaaS endpoint. The agent only permits plain HTTP on loopback for local development.
