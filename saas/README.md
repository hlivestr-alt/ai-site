# Content Workspace customer SaaS

This separate customer application runs at `http://127.0.0.1:3200`. Its Postgres and private S3-compatible storage belong to this project's Compose stack. The internal AI Site in `../app` is separate.

## Start locally

1. Copy `.env.example` to `.env.local`; set distinct local database credentials, `DATABASE_URL`, `TEST_DATABASE_URL`, and `APP_BASE_URL=http://127.0.0.1:3200`. Set the storage endpoint to `http://127.0.0.1:9000`, separate dev/test buckets, and local S3 credentials.
2. `docker compose --env-file .env.local up -d`
3. `npm install`
4. `npm run db:migrate` and `npm run storage:init`
5. `npm run dev`
6. Open `http://127.0.0.1:3200/register`. Verification, invitation and recovery links appear at `/dev/mailbox` only on loopback in local mode.

Run `npm run db:status`, `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` to validate. Browser tests use installed Google Chrome and the isolated test database and bucket.

For multi-PC testing through the existing Cloudflare Tunnel, follow [remote-test private storage](docs/remote-test-storage.md) to configure a separate browser signing endpoint, exact-origin CORS and the storage route's canonical Host.

See [Phase 2 documentation](docs/phase2/README.md) for Products, assets, storage, isolation, lifecycle, and Phase 3 contracts. See [Phase 1 documentation](docs/phase1/README.md) for identity and workspaces.
