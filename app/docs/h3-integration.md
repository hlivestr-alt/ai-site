# MiniMax H3 integration: Phase 2 boundary

Inspected on 2026-09-23. AI Site acts only as a read-only client of the existing Creative Studio local runner. It does **not** submit generation jobs in this phase because the current HTTP contract cannot safely fulfill a one-video request with chosen duration and uploaded references.

## 1. Service location and structure

The existing project is `the existing Creative Studio repository`. Its Electron/React/TypeScript/Vite operator app builds a `LocalSessionBundle`; the separate Node runner lives in `src/local-runner` and is packaged under `runtime/runner`. The runner uses local ComfyUI MiniMax H3 at `127.0.0.1:8188` and LM Studio at `127.0.0.1:1234`. Its default HTTP listener is `127.0.0.1:8787`. The live runner reported version `2.1.4-production.20260912`, `mode=production`, and `maxJobsPerSession=null`. A single read-only `/health` call reported runner dependencies ready.

## 2. Endpoints

AI Site calls only:

- `GET the native runner API prefix/capabilities`
- `GET the native runner API prefix/health`

The runner also exposes `GET the native runner API prefix/session/current`, `/session/:id`, `/jobs?sessionId=...`, and `/jobs/:id/artifact`; `POST the native runner API prefix/stage`, `/start`, and stop/settings operations. These are documented for future work, but this platform does not call them. No WebSocket or SSE status endpoint exists in this runner API; job updates would be polled. `GET /jobs` includes a runner job ID, phase, Comfy prompt ID, archive path, and error when present. The artifact route streams only completed MP4 files from the configured archive root.

## 3. Configuration

`H3_BASE_URL` is a **server-only** optional setting in this new project. It defaults to `http://127.0.0.1:8787`. Only plain HTTP loopback origins are accepted. The browser calls AI Site's `GET /api/ai-video/status`, which returns a filtered connection summary with no local paths, runner URL, or secrets. Fetches use no cache, reject redirects, and time out after five seconds. `.env.example` contains the placeholder. No Creative Studio configuration is changed.

## 4. Submission request format and blocker

The existing `POST the native runner API prefix/stage` accepts a complete `LocalSessionBundle`, not a prompt or multipart image upload. It requires a UUID, exact runner/schema versions, selected verified product metadata, content types, ordered selection, reference assets with base64 content and SHA-256, verified master path bindings, H3 brief/settings, system prompt and hash, validated workflow JSON and hash, archive root, and a canonical bundle hash. Stage writes runner session files and its own SQLite state. `POST the native runner API prefix/start` accepts `{ sessionId, bundleHash }`, returns a session status, and starts the runner's autonomous scheduler.

The Creative Studio bundle builder intentionally sets `repeatPolicy: { mode: 'forever' }`. Although the type includes `cycles`, the runner scheduler does not use `repeatPolicy` to enforce a finite job count. In the live `production` mode, `maxJobsPerSession` is `null`; Start continues planning jobs. Sending Stop After Current in a second request would leave an unsafe gap if the platform or network failed between calls. A canary mode would cap jobs, but switching the existing runner mode is outside this phase and would affect Creative Studio.

The scheduler also calls `selectAutoDuration()` when it plans each job, overriding `settings.brief.duration`. It reconstructs the reference plan from Creative Studio's selected product and verified staged masters. An arbitrary uploaded reference image or requested duration on the AI Site page would therefore be ignored or misrepresented. The existing UI does not expose a safe prompt-only, one-job HTTP request.

**Required future contract:** a reviewed, atomic one-job operation in the existing service that accepts a validated prompt, explicit supported settings, and defined reference assets, returns stable job/session IDs, and enforces one job without a follow-up Stop request. This would require a separate change to Creative Studio; no such change was made here.

## 5. Response and job IDs

`POST /stage` would return `sessionId`, `bundleHash`, revision, and mode. `POST /start` would return the same identity and a starting status. `GET /jobs` exposes `jobId` and eventually `promptId` from ComfyUI. AI Site currently stores none of these IDs because it submits no jobs.

## 6. Status mechanism

The server adapter normalizes read-only capabilities and health into `connected`, `unavailable`, or `misconfigured`. `connected` means the runner and dependencies answered; it does **not** mean this website can generate. The status is displayed on AI Videos and Settings. Future job polling could map runner phases such as `PREPARING`, `SUBMITTED`, `RUNNING`, `ARCHIVED`, `COMPLETED`, and `FAILED` without inventing progress percentages.

## 7. Completed output

The runner archives MP4 output under its configured `D:\AI Videos` root and exposes `GET the native runner API prefix/jobs/:id/artifact` after completion. AI Site has no known platform job IDs yet, so it does not proxy or display files. A future output proxy should authorize only a platform-owned job mapping and stream the runner artifact read-only; it must never accept arbitrary browser paths or move existing output files.

## 8. Error handling

The adapter returns short, browser-safe messages for invalid configuration, offline runner, unhealthy dependencies, malformed responses, or timeouts. It never returns raw errors, local paths, or stack traces. The Settings check is harmless and makes no production state transition.

## 9. Known limitations and history

- Generate Video is disabled. There is no `/api/ai-video/generate` route and no stage/start call.
- Uploaded arbitrary images, fixed duration, and a guaranteed one-video request are unsupported by the current runner API.
- The H3 workflow validates 4–15 seconds and supports 9:16 among its aspect ratios. The current Auto Run scheduler selects 8–15 seconds automatically, so the platform cannot promise a chosen duration.
- No AI Site generation history database was created because no platform jobs exist. The page truthfully shows an empty history placeholder.
- Clipper and Outreach are outside this phase.

## 10. Starting and checking both systems

Start Creative Studio and its runner by the existing application's normal launcher. Do not start a second runner against the same state root. The current runner can be checked at `http://127.0.0.1:8787the native runner API prefix/capabilities`. Start AI Site separately:

```powershell
cd C:\Data\ai-site\app
npm install
npm run dev
```

Open `http://127.0.0.1:3100` and use **Settings → Local MiniMax H3 → Check connection**. If H3 stops, the platform remains usable and reports Unavailable.

## 11. Existing-system change statement

No Creative Studio or H3 source, workflow, prompt, configuration, output, or database was modified by this task. No generation was triggered. All code changes are inside `C:\Data\ai-site\app`.
