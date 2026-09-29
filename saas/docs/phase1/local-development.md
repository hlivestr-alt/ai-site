# Local development

Copy `.env.example` to `.env.local` and fill the SaaS-only Postgres URLs. For the supplied compose stack, use port `5543` and database names `saas_dev` / `saas_test`, with the same new local Postgres user and password. `APP_BASE_URL` is `http://127.0.0.1:3200`.

```text
docker compose --env-file .env.local up -d
npm install
npm run db:migrate
npm run dev
```

Open `/register`, then `/dev/mailbox` to follow the verification link. The test mailbox also contains invitation and password recovery links. It is intentionally inaccessible outside the loopback local configuration. `npm test` migrates and uses `saas_test`, starts its own server, and exercises installed Google Chrome through Playwright; keep port 3200 free while it runs.

The internal AI Site remains separately startable on port 3100. This project has its own package manifest, environment, database, migrations and runtime port.
