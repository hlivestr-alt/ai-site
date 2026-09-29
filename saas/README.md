# Content Workspace customer preview

This is the separate Phase 1 customer SaaS control plane. It runs on `http://127.0.0.1:3200` and owns only its Postgres database on local port `5543`. The internal AI Site in `../app` continues to run independently on port `3100`.

## Start locally

1. Copy `.env.example` to `.env.local` and set unique local Postgres credentials and both database URLs. `APP_BASE_URL` must be `http://127.0.0.1:3200` for the development mail sink.
2. `docker compose --env-file .env.local up -d`
3. `npm install`
4. `npm run db:migrate`
5. `npm run dev`
6. Open `http://127.0.0.1:3200/register`. Verification, invitation and recovery links appear at `/dev/mailbox` only on loopback in local mode.

Run `npm run db:status`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` to validate. Browser tests use installed Google Chrome and the isolated `TEST_DATABASE_URL`.

See [Phase 1 documentation](docs/phase1/README.md) for implemented contracts, security rules and Phase 2 handoff.
