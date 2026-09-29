# AI Site

Standalone Next.js/TypeScript/Tailwind platform for AI Videos, Clipper, and Outreach. AI Videos uses the validated local H3 bridge. Outreach draft, preview, freeze, and a feature-gated native queue confirmation are available. Clipper submission remains in its native app.

## Run locally

```powershell
cd C:\Data\ai-site\app
npm ci
npm run build
pwsh -File .\start-platform.ps1
```

Open <http://127.0.0.1:3100>. Port 3100 avoids the existing Outreach web service on port 3000. The current ignored `.env.local` disables AI Site login and enables the native Outreach queue gate. See [`docs/platform-operations.md`](docs/platform-operations.md) for startup, restart, and the public-route note. `configure-login.ps1` remains available if login is enabled later.

## Check

```powershell
npm run lint
npm run typecheck
npm run build
npm test
```

## Current scope

- Home, AI Videos, Clipper, Outreach, and Settings pages.
- Navigation and responsive desktop layout.
- Validated one-video H3 requests with references, status, history, preview, and download.
- Read-only Clipper watched sources, jobs, and score records when Clipper is running.
- Read-only Outreach campaign and sending counts from a server-only PostgreSQL transaction.
- One-click Outreach campaign sending through native create, recipient preview, freeze, and send endpoints. The current runtime enables Send Campaign; the example configuration defaults the queue gate off.
- Clipper submission remains native-only.
- Independent `C:\Data\ai-site\h3-bridge` generation and status.
- Read-only MiniMax H3 connection check, with browser-safe status through the platform server.
- Integration adapters under `src/lib/integrations`.
- Existing system findings and integration recommendations in [`docs/existing-systems-inventory.md`](docs/existing-systems-inventory.md).
- Exact H3 submission blocker and API notes in [`docs/h3-integration.md`](docs/h3-integration.md).
- Phase 2 integration findings in [`docs/clipper-integration.md`](docs/clipper-integration.md), [`docs/outreach-integration.md`](docs/outreach-integration.md), and [`docs/h3-one-shot-bridge.md`](docs/h3-one-shot-bridge.md).
- Phase 3 native campaign write boundary in [`docs/outreach-write-integration.md`](docs/outreach-write-integration.md).
- Phase 5 queue boundary and enablement in [`docs/outreach-production-integration.md`](docs/outreach-production-integration.md).
- Current operations in [`docs/platform-operations.md`](docs/platform-operations.md); the earlier exposure audit in [`docs/security-review.md`](docs/security-review.md) is a historical snapshot.

`.env.example` lists server-only settings. H3, bridge, Clipper, and Outreach API addresses default to loopback services. Set `OUTREACH_DATABASE_URL` in ignored `.env.local` for live campaign data. Never use `NEXT_PUBLIC_` for service addresses or credentials.

The shared light/dark interface and namespace migration are documented in [docs/ui-migration.md](docs/ui-migration.md). Run `npm run test:ui` after building to validate the interface with isolated credentials and mocked service reads.
