# AI Site operations

## First-time setup

1. Install project dependencies in `C:\Data\ai-site\app` with `npm ci`. Build with `npm run build`.
2. Build the separate bridge in `C:\Data\ai-site\h3-bridge` with `npm ci` and `npm run build` if its `dist/server.js` does not exist. Its own generation configuration remains unchanged.
3. Set server-only values in ignored `.env.local` using `.env.example` as a guide. The current runtime uses `AUTH_ENABLED=false` and `OUTREACH_QUEUE_ENABLED=true`. Never prefix secrets with `NEXT_PUBLIC_`.
4. If login is enabled later, run `pwsh -File .\configure-login.ps1` to set the operator password at a masked prompt. The script writes a password hash and session secret to ignored `.env.local`; it never writes the plaintext password.

No plaintext password is written to disk by the configuration script. Keep `.env.local` private and do not paste it into bug reports.

## Current no-login runtime

Authentication defaults to enabled when `AUTH_ENABLED` is absent. The current ignored `.env.local` explicitly sets `AUTH_ENABLED=false`; the existing password hash and session secret remain available for future re-enablement.

With authentication disabled, Home, AI Videos, Clipper, Outreach, Settings, and AI Site APIs do not require a session. `/login` redirects to Home. Account and logout controls are hidden. Same-origin validation remains required for write requests, including generation and campaign actions.

AI Site itself binds to `127.0.0.1:3100`. The existing Cloudflare route `ai-test.proyaofficial.com → localhost:3100` can also make the no-login app publicly accessible. If AI Site is intended to remain internal-only, remove or disable that route manually in Cloudflare. AI Site does not change Cloudflare configuration.

To restore login, set `AUTH_ENABLED=true` in `.env.local` and restart AI Site. No code changes or rebuild are needed: the flag and account UI are evaluated at request time. Existing password hashing, server-side sessions, HttpOnly cookies, logout, route protection, tests, and `configure-login.ps1` remain available.

`OUTREACH_QUEUE_ENABLED=true` keeps the New Campaign “Send Campaign” action available without login. The gate is independent of `AUTH_ENABLED`; native frozen-recipient, version, sender-availability, and duplicate protections still apply. Settings shows “Outreach Sending — Enabled”. No campaign needs to be queued to check the UI.

## Network and sending path

AI Site 3100, H3 Bridge 8788, and native Outreach 4000 listen on loopback. Docker publishes Outreach 4000 only to `127.0.0.1`. The operator manually inspected the active Cloudflare routes: AI Site points to 3100, while no route to Outreach 4000 or wildcard/catch-all route was shown. That inspection does not change the existing tunnel.

Sending follows AI Site → native Outreach API on loopback → native `OutreachService.send` → durable queue → existing worker and sender. The single button advances native create, preview, freeze, and send calls automatically. AI Site has no sender or direct campaign/send SQL writer. The server re-reads frozen campaign state and version before calling the native API. Native state transitions and deterministic delivery/outbox keys remain the final duplicate guard. AI Site stores small operation journals under ignored `data/outreach-operations/` so a refresh resumes the same campaign. A create request with an unknown native outcome is never repeated automatically because native create has no idempotency key.

Phase 6 reported a tunnel credential in command output, so operator token rotation is recommended separately. Phase 7 found no persisted Cloudflare token in owned project/validation text and did not rotate credentials. Do not paste process/service command lines containing tunnel credentials into logs or reports.

## Audit and verification

AI Site-owned daily audit files are stored under ignored `data/audit/YYYY-MM-DD.jsonl`. They record campaign creation/preview/freeze, queue attempts/results, and H3 requests with timestamp, action/result, validated IDs and optional count. Actor is `unauthenticated` in the no-login runtime; auth-enabled mode derives `operator` only from a valid session. Bodies, uploads, messages, cookies and credentials are excluded. An audit disk failure emits a neutral warning without changing native action outcomes.

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:ui`, and `npx playwright test --config playwright.local.config.ts`. The browser suites start isolated loopback servers on 3101 (auth enabled) and 3102 (auth disabled with the queue gate enabled); they preserve port 3100's runtime settings. Queue tests mock native requests and never send creator messages. Historical Phase 7 checks are recorded in [Phase 7 validation](phase7-validation.md).

## Start after reboot

From PowerShell: `pwsh -File C:\Data\ai-site\app\start-platform.ps1`

The project-owned script checks `127.0.0.1:8788` and `127.0.0.1:3100`, reuses recognizable healthy instances, starts a missing H3 bridge and Platform in hidden windows, and reports port conflicts without killing any process. It does not start or change Creative Studio, ComfyUI, Clipper, Outreach, or n8n. Use `-NoOpen` to avoid opening a browser. Logs are kept in ignored `bridge.stdout.log`, `bridge.stderr.log`, `platform.stdout.log`, and `platform.stderr.log` in the platform directory.

The platform uses 3100, H3 bridge 8788, native Outreach API 4000, and H3 service 8787. All new project listeners bind to loopback. The platform's Clipper, Outreach, and H3 service URLs are server-only loopback settings.

## Troubleshooting and restart

- If startup reports an occupied port, inspect the PID and command line. Do not kill an unknown process to free the port.
- If login says configuration is missing, run `configure-login.ps1`, then restart only AI Site.
- If a system card says offline, check that system's own application and local health endpoint; Platform will keep its other tools available.
- If H3 is busy, wait for the existing generation to finish. Do not restart ComfyUI or Creative Studio to clear a normal busy state.
- If Outreach is offline, check its native app. Campaign creation/preview/freeze and new queue attempts may be unavailable until its native service or sender returns.

For a planned Platform restart, find the listener on port 3100 with `Get-NetTCPConnection -State Listen -LocalPort 3100`, verify its process command line, stop **only that verified Platform process**, and rerun `start-platform.ps1`. For the bridge, follow the same process on port 8788, but do not stop it while a generation is active. The startup script itself never stops running processes.

## Optional Windows startup later

An operator may later create a Windows Task Scheduler entry that runs `pwsh -File C:\Data\ai-site\app\start-platform.ps1 -NoOpen` at sign-in, under the intended local account. Review the account, working directory, and access to `.env.local` first. Phase 6 did not create or enable any scheduled task or Windows startup entry.
