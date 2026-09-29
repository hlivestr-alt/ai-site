# Outreach production integration

AI Site is a server-side client of the existing native Outreach API. It creates no sender, worker, provider client, reservation logic, or campaign/send SQL writer. The native Outreach repository was read but not edited.

**Current runtime:** `AUTH_ENABLED=false`, `OUTREACH_QUEUE_ENABLED=true`. AI Site opens without login and exposes a single “Send Campaign” action. The operator manually verified that the active Cloudflare tunnel routes AI Site to port 3100 and does not show a direct Outreach port 4000 or wildcard route. AI Site does not change Cloudflare configuration.

## Native lifecycle and boundary

1. `POST /api/v1/outreach/campaigns` calls `OutreachService.create`. The API validates target, cooldown, ranking, filters, and message rendering, allocates a campaign name, and commits a `DRAFT` campaign.
2. `POST /:id/discovery-runs` calls `OutreachService.discover`; its existing local creator database logic builds the recipient preview with creator filters, ranking, contact cooldown, and reservation exclusions. AI Site reads the authoritative native campaign state after the call.
3. `POST /:id/freeze` calls `OutreachService.freeze(id, version)`. Under the native transaction, it locks creator eligibility, rechecks exclusions, creates reservations, renders immutable recipient messages and hashes, and moves the campaign to `FROZEN` with a 30-minute expiry. If none remain, the native state becomes `PREVIEW_EXPIRED`.
4. `POST /:id/send` with `{ "version": <current frozen version> }` calls `OutreachService.send`. It requires outbound capability. For a `FROZEN` campaign, `queueFrozen` atomically changes state/version, rechecks reserved recipients, upserts one `OutreachDelivery` and one `QueueOutbox` per recipient with deterministic keys, and writes an audit event. It then asks the existing `QueueService` to reconcile the durable outbox into the existing BullMQ queue. The existing outbound worker alone performs TikTok delivery, pacing, retry, and `DELIVERY_UNKNOWN` handling.

Native `send` also supports a `PREVIEW_READY` one-click freeze-and-queue path, but the platform intentionally accepts only `FROZEN` for final confirmation. The native transaction's conditional state/version update and unique per-recipient outbox/delivery records prevent a duplicate materialization. Native `send` returns the authoritative campaign for repeated calls after it has already entered a queued or later active state.

The native API is bound to loopback. The examined controller has no route-level credential or idempotency-key header for `/send`; its `version` and campaign identity are the activation contract. AI Site calls the API server-side through a validated loopback URL. AI Site write routes require JSON and reject a foreign browser Origin. The operator has intentionally disabled AI Site login while keeping the server-side queue gate enabled.

## One-click AI Site flow

The New Campaign form shows native-supported filters, target count, and an editable message loaded from the native template endpoint. One “Send Campaign” click starts an AI Site operation. The server creates one native draft, requests the native preview, stops if no recipients were selected, calls native freeze, then queues the actual frozen count through the existing adapter. The browser automatically advances and opens Campaign Details when native state confirms queueing.

AI Site stores an operation key in the page URL and a small server journal under ignored `data/outreach-operations/`. Repeated requests, refreshes, and double clicks reuse the same native campaign. Once native create has been attempted, a missing/uncertain response cannot safely be retried because that native endpoint has no idempotency key; AI Site stops and directs the operator to check Outreach. After a campaign ID is recorded, recoverable errors resume against that same native campaign. No message body or secrets are stored in the journal.

`POST /api/outreach/send-campaign` runs the idempotent operation. It uses the existing `confirmAndQueueCampaign` adapter, which re-reads the authoritative native campaign, requires matching ID/version, state `FROZEN`, at least one frozen recipient, unexpired freeze, and a live available native outbound worker. It then calls native `/send` once. It does not automatically retry an uncertain request. The native state is the final duplicate guard across AI Site processes; an in-process single-flight guard coalesces concurrent requests on one server. If native state is already queued or running, the adapter returns it without another POST. Errors sent to browsers omit native response bodies, connection strings, and credentials.

On success the UI navigates to `/outreach/<campaign-id>`. That page refreshes the existing read-only campaign overview every 15 seconds and shows frozen, queued, sending, sent, restricted, failed, delivery unknown, remaining, and progress counts. The platform maintains no separate sending counter. Pause and resume remain in the native operator app; its native endpoints exist, but resume can release real sends and were outside this phase's validation.

## Feature gate and enablement

`OUTREACH_QUEUE_ENABLED` is server-only and defaults to false in `.env.example`; ignored `.env.local` currently sets it to true. The gate is independent of the optional AI Site login. Browser claims about gates, URL, credentials, or sender availability cannot override server state. Native sending still requires a frozen campaign, valid version, nonempty unexpired recipient set, and available native sender. Clicking “Send Campaign” is the operator action; no additional acknowledgement is requested.

No dedicated production test creator, sandbox provider route, or non-delivery canary was established in the examined native system. Mocked tests validate the queue boundary without sending creator messages. **Current queue-gate value: true.**

To disable new AI Site queue actions, set `OUTREACH_QUEUE_ENABLED=false` in `.env.local` and restart AI Site. Existing native queued work remains governed by the native operator app. The native backend refuses activation when outbound capability is unavailable. To restore AI Site login later, set `AUTH_ENABLED=true` and restart AI Site; the existing password hash, sessions, and route protection remain in code.

## Validation and limitations

Current tests cover both login modes, gate on/off, invalid/missing/expired freeze, stale versions, unavailable sender, concurrent/repeated confirmation, uncertain failure recovery, URL injection rejection, malformed-response sanitization, and read-only SQL. Every queue request in automated tests is mocked. Native source review confirms conditional state/version transitions and unique recipient delivery/outbox keys. The earlier Phase 7 snapshot remains in [historical validation](phase7-validation.md).

Lightweight AI Site auditing is in ignored `data/audit/YYYY-MM-DD.jsonl`. It records create, preview, freeze, and final queue attempts/results with validated IDs and optional counts, excluding messages and secrets. Current no-login actions are marked `unauthenticated`; login-enabled actions derive the operator from the session. Campaign detail UI reads the overview instead of the native detail GET that may expire state.

Automated tests mock every queue request and cover validation, frozen state, sender availability, stale versions, duplicate requests, gate on/off, native rejection, and sanitized summaries. They do not send creator messages. Live checks were read-only: the platform overview returned 44 recent campaigns, including native sending counts, one `PREVIEW_READY` campaign returned 25 mapped recipients, and native sender status reported available. Native campaign list/detail GETs can expire stale previews as a side effect, so the platform's general campaign list stays on a server-side read-only PostgreSQL transaction. The final confirmation endpoint intentionally uses native detail GET to obtain authoritative activation state and accepts the native expiry behavior.
