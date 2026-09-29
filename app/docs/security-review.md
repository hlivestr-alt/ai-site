# Phase 7 security review — 2026-09-26

AI Site is in **Local Test Mode**: ignored runtime configuration remains `AUTH_ENABLED=false` and `OUTREACH_QUEUE_ENABLED=false`. Login is intentionally bypassed, while exact same-origin write protection remains active. Production sending is **not allowed**. The queue adapter also rejects local test mode when isolated tests deliberately set the queue gate to true; it makes no native request.

## Exposure evidence and limits

| Service | Direct listener / publication | Direct LAN test | Tunnel exposure | Overall conclusion |
| --- | --- | --- | --- | --- |
| AI Site, 3100 | Windows `127.0.0.1:3100`; dev/start scripts bind loopback | This machine's LAN/virtual adapter connections failed | Unresolved | Loopback listener verified; complete network isolation unproven |
| H3 bridge, 8788 | Windows `127.0.0.1:8788`; source binds loopback | Same targeted checks failed | Unresolved | Loopback listener verified; complete network isolation unproven |
| Native Outreach, 4000 | Windows `127.0.0.1:4000`; Docker `127.0.0.1:4000->4000/tcp` | Same targeted checks failed | Unresolved | Loopback publication verified; complete network isolation unproven |

Only the three specified ports on the machine's own addresses were tested. This was not a network scan, public endpoint probe or native send endpoint test. Listener/publication evidence supports no direct LAN exposure; it cannot rule out a tunnel or reverse proxy.

**Cloudflare exposure unresolved.** The running automatic `Cloudflared` Windows service uses token-based remotely managed routing. Startup metadata was reduced to safe predicates; no token value was emitted or persisted. No local ingress configuration or origin certificate was found in user, system-profile, ProgramData or installed Cloudflared locations. No installed `wrangler`, Cloudflare connector or accessible authenticated Cloudflare browser session was available. There are no verified hostnames, upstream destinations, wildcard routes or Access policies. References to ports 3100, 8788 and 4000 cannot be verified. AI Site routed: **UNRESOLVED**; H3 routed: **UNRESOLVED**; Outreach routed: **UNRESOLVED**. Routes readable: **NO**; manual remote inspection required: **YES**. The tunnel was not changed or restarted.

The localhost-only **requirement** is not an assertion that remote ingress has been conclusively excluded. Do not publish auth-disabled AI Site. If remote routes expose it, local test mode is a security blocker. Do not route the unauthenticated H3 bridge either.

Native `POST /api/v1/outreach/campaigns/:id/send` has no route-level credential requirement. Untrusted-network reachability is **UNRESOLVED**. Native Outreach is not yet network-safe: neither strict loopback with no proxy/tunnel nor a trusted external access boundary has been established. Access protection must not be assumed. If port 4000 is routed or exposed, future remediation must restrict/remove that ingress or establish reviewed access isolation. Phase 7 does not modify native Outreach or external network settings.

## Authentication and same-origin protection

Authentication defaults to enabled when absent. Local mode preserves the auth implementation and credentials. Home, AI Videos, Clipper, Outreach, Settings and API reads bypass the session requirement; `/login` redirects home and no authenticated operator is claimed. Missing or foreign Origins reject platform writes, including campaign actions and H3 generation. Browser input cannot set server gates, native URLs, credentials or authoritative sender state.

Isolated auth-enabled tests restore protected pages/APIs, operator login, opaque eight-hour server sessions, keyed session digests, HttpOnly/SameSite=Strict cookies, logout and session revocation. HTTPS cookies use Secure. The process-local login attempt limit remains intact. Runtime auth was never enabled on port 3100 in this phase. Auth-disabled dev/start requires an explicit loopback hostname.

Production queueing requires **both** `AUTH_ENABLED=true` **and** `OUTREACH_QUEUE_ENABLED=true`, plus verified network isolation and a controlled canary plan. Configuration can enable the existing integration later without source edits; these conditions are not satisfied now.

## Native adapter and H3 regression

AI Site calls the existing native Outreach queue/sender server-side. It has no second sender, worker, provider client, reservation system or SQL writer. Campaign overview SQL executes in `BEGIN READ ONLY`. Confirmation validates identity/version, frozen state/count, valid unexpired freeze and live worker capability. Same-version requests coalesce; different versions receive independent stale checks. Repeated confirmation reads native activated state without another send POST. Uncertain requests are never automatically retried. Native conditional state/version transitions and unique delivery/outbox keys remain the durable duplicate boundary. Malformed native JSON and native failure bodies are not echoed to browsers.

H3 bridge source/configuration and generation behavior are unchanged. UUID job directories, fixed artifact paths, isolated reference names, 30 MB body / 10 MB image limits, one or two references, and 4096×4096 dimension limits remain. Browser uploads map to generated filenames rather than browser-selected filesystem paths. H3 tests use mocks/temporary fixtures, never live generation. Clipper monitoring, offline state and Open Clipper retain their native boundary.

## Audit and credential hygiene

Daily JSONL audit files live under ignored `data/audit/`. Events cover campaign creation, preview, freeze, queue attempts/rejections/future acceptance/already-queued results, and H3 requests. Rejected sensitive writes are recorded at the proxy too. Actor is `local-test` now; with auth enabled it is the actual session's `operator`, or `unauthenticated` for rejected unauthenticated requests. Client actor claims are ignored.

Only timestamp, predefined action/result/actor, validated campaign/job UUID and nonnegative count may be stored. Request bodies, uploads, full messages, headers, cookies, passwords/hashes, session secrets, DB credentials, provider and tunnel tokens are excluded. Audit-storage failure emits a neutral warning and does not misreport a completed native action as failed. This is a local operational audit, not a tamper-proof/distributed audit; Windows directory ACLs and retention remain operator responsibilities.

The owned-area scan covers text in `app`, `h3-bridge` and `validation`, including generated logs/build files and runtime metadata; dependencies, Git internals, symlinks and binary files are skipped. **Secret-like Cloudflare token persisted: NO. Cleanup files: none.** Browser static chunks contain no configured secret values. **Token rotation recommended: YES**, because Phase 6 reported a token in command output. Rotation was not performed. System logs and unrelated user files were not searched or changed.

Known safe test recipient exists: **NO** (none conclusively established in examined documentation/configuration; mocks do not count). Do not infer team ownership from a test-like name or choose a random creator. A future canary requires explicit team ownership and permission to contact.

## Validation and unchanged systems

See [the Phase 7 report](phase7-validation.md) for final counts and browser results. Live checks only read campaign overview/counts, worker/service health and existing UI. Native campaign-detail/list GETs that can expire previews were unnecessary and not used. No campaigns were queued, creator messages sent or real H3 generations performed. Existing Creative Studio, Clipper, Outreach, crawler, n8n, ComfyUI, DB schemas, native sender and queue semantics were not modified. Only AI Site was restarted to load its production build.
