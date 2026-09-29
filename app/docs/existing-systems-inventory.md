# Existing systems inventory

Inspected read-only on 2026-09-23. This document describes source and documented boundaries, not an authorization to send jobs or write existing data. No existing service or database is connected to AI Site in Phase 1.

## MiniMax H3

- **Project:** `the existing Creative Studio repository` (Existing Creative Studio). The separate `C:\Data\local-video-maker` is another Electron project, not the MiniMax H3 control plane identified here.
- **Technology:** Electron desktop app; React/TypeScript/Vite UI; Node local generation runner; ComfyUI MiniMax H3 workflow; LM Studio prompt engine. Creative Studio uses SQLite for its own state and archives generated videos under `D:\AI Videos`.
- **Current process:** the bundled local runner `runtime/runner/runner.cjs` was observed running, listening on `127.0.0.1:8787`. ComfyUI was observed listening on `127.0.0.1:8188`; LM Studio on `127.0.0.1:1234`. These are observations, not ports reserved by this platform.
- **Existing API:** `GET the native runner API prefix/capabilities`, `/version`, `/health`, `/session/current`, `/session/:id`, `/jobs`, and `/jobs/:id/artifact`; `POST the native runner API prefix/stage`, `/start`, and session controls. See `src/local-runner/api.ts`. The runner requires a structured `LocalSessionBundle`; a free-text prompt and image are not sufficient to start a safe job. Its capabilities can disable generation and `shadow` mode rejects Start.
- **Safe integration option:** a server-side read-only capabilities/health adapter is now implemented in the platform. Generation remains disabled because live production Start has no one-job limit, the scheduler replaces requested duration, and it rebuilds references from verified product masters. See [h3-integration.md](h3-integration.md) for the exact contract and blocker. Do not call ComfyUI or LM Studio directly from browser UI.
- **Risks:** bypassing Creative Studio's planning and staging rules, duplicate starts, local file path exposure, large image payloads, and GPU contention. Never reuse Creative Studio's SQLite or runner state database for platform state.

## Clipper

- **Project:** `C:\Data\Clipper Ai Trends` (Existing Clipper).
- **Technology and structure:** Python pipeline and FastAPI `clipper_app/web_api.py`; React/TypeScript/Vite frontend under `new_app/src`; Electron wrapper under `new_app/electron`. Standard and Modular clip processing have existing resumable queues and storage. Clipper also contains a separate Auto Video desktop feature; it is outside the platform Clipper module scope.
- **Current URLs:** documented development frontend `http://127.0.0.1:5173`, FastAPI `http://127.0.0.1:8765`. These ports were not observed listening during inspection; the desktop application can start its own backend. Vite proxies `/api` to FastAPI.
- **Existing API examples:** `GET /api/dashboard`, `/api/queue`, `/api/queue/vods`, `/api/overview`, `/api/scores`, `/api/compliance`; operation routes also exist in `clipper_app/web_api.py`. Mutating requests and some sensitive GET routes require a per-process Bearer `CLIPPER_CONTROL_TOKEN`. Origin and host checks apply. Do not put this token in browser code.
- **Persistence:** standard queue state can be JSON or SQLite; Modular Scanner, Planner, Renderer, and Production own separate SQLite databases and file artifacts. Media and working directories are authoritative or recovery-sensitive. See `docs/ARCHITECTURE.md` and `docs/DATA_AND_STORAGE.md`.
- **Safe integration option:** initially link to the current operator application after its actual runtime URL is known. A later server-side adapter may expose a narrowly approved subset of existing read/operation APIs with the existing token kept server-side. Preserve Clipper's established frontend and workflow. Do not add automatic AI video generation to this module.
- **Risks:** desktop-spawned dynamic token and backend lifecycle, API origin rules, long-running jobs, and accidental overlap with active queue operations. Embedding or API control should be validated with the Clipper operator before implementation.

## Outreach

- **Project:** `C:\Data\TikTok Outreach`.
- **Technology:** pnpm TypeScript monorepo; Next.js web and Electron/native operator shell; NestJS/Fastify API; PostgreSQL via Prisma; Redis/BullMQ; dedicated discovery, history, and outbound workers. Docker Compose production binds web to `127.0.0.1:3000`, API to `127.0.0.1:4000`, PostgreSQL to `127.0.0.1:5432`, Redis to `127.0.0.1:6379`. The web and API ports were observed listening. The API documentation route is `/api/docs`.
- **Database entities:** `Creator`, `CreatorProviderIdentity`, `CreatorMetricSnapshot`, `CreatorShopContactState`, `Campaign`, `CampaignRecipient`, `OutreachDelivery`, `DeliveryAttempt`, `QueueOutbox`, `OutreachReservation`, and `OutboundDispatchEvent`, among others. The creator crawler and database administration remain with the native app and dedicated workers.
- **Campaign API:** `GET/POST /api/v1/outreach/campaigns`; `GET /:id`, `/:id/preview`, `/:id/recipients`; `POST /:id/discovery-runs`, `/:id/freeze`, `/:id/send`, `/:id/pause`, `/:id/resume`, `/:id/cancel`, plus clone and discovery cancellation. See `apps/api/src/outreach/outreach.controller.ts`.
- **Campaign workflow:** create persists a draft with a target and filters; preview is built from stored creator snapshots; freeze records selected recipients and immutable rendered messages; explicit Send materializes deliveries and durable outbox intents; outbound worker dispatches. Pause is cooperative. `DELIVERY_UNKNOWN` is never automatically resent.
- **500-recipient behavior:** `Shop.maxRecipientsPerCampaign` defaults to 500, and API creation validates requested target against that persisted shop limit. A 500-recipient send can create 500 durable outbox records. The number is a capacity ceiling, not a guarantee that 500 creators qualify or messages are sent.
- **Queue:** PostgreSQL `QueueOutbox` is durable intent and source of truth; API/worker sweepers reconcile safe queued recipients into deterministic BullMQ jobs in Redis. A delivery's state, not queue presence, determines sending status. The outbound worker applies provider admission and safety checks.
- **Safe integration option:** later use a platform server-side adapter to call an approved API subset. Scope the website to Campaigns and Sending. Never connect browser code to PostgreSQL, Redis, provider credentials, or crawler APIs. Confirm authentication, CORS/proxy design, and GET side effects before enabling any calls. The current `list()` service invokes `expireFrozenCampaigns`, which may write to PostgreSQL even on a GET; Phase 1 therefore does not poll it.
- **Risks:** campaign actions can send real TikTok messages; read endpoints may have state effects; browser API access currently allows only the existing web origins. Any new authorization/proxy requirements belong to a reviewed later phase. Do not bypass the API's idempotency, eligibility, cooldown, and delivery-unknown safeguards.

## Platform boundary and Phase 1 decision

The new project's `src/lib/integrations/{h3,clipper,outreach}` directories reserve separate server-side adapters. They contain no network calls or database clients. UI uses explicit placeholders and disabled actions. Platform downtime therefore cannot stop the existing systems, and existing service downtime cannot corrupt platform data. Any integration requiring edits to an existing app, a new API permission, a token handoff, or database writes needs a separate reviewed implementation.

## Inspection limits

This inventory came from repository documentation, source, and local listening-process metadata. No live service requests, database queries, migrations, or production control commands were run. Runtime health and authentication behavior should be verified when integration work is authorized.
