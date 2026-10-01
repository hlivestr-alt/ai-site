# Quotas and rate limits

| Workspace control | Default | Environment |
|---|---:|---|
| Nonterminal Jobs | 20 | QUOTA_ACTIVE_JOBS |
| Nonterminal Runs, including paused/waiting | 10 | QUOTA_ACTIVE_WORKFLOWS |
| Queued/waiting AI Videos | 10 | QUOTA_QUEUED_AI_VIDEOS |
| Queued/waiting Clipper Jobs | 5 | QUOTA_QUEUED_CLIPPER_JOBS |
| Source intents per UTC day | 20 | QUOTA_SOURCE_UPLOADS_DAILY |
| Stored/projected bytes | 20 GiB | QUOTA_STORAGE_BYTES |
| Nonarchived Product Assets | 500 | QUOTA_PRODUCT_ASSETS |

Per-workspace operator overrides are integer values with actor/time provenance. SET_QUOTA requires an explicit reason and audit trail. Lowering a limit preserves existing work/history and blocks new admission/finalization that exceeds it. No credit adjustment accompanies a quota change.

A transaction-scoped workspace advisory lock serializes admission and upload allocations across customers and processes. Job/Workflow checks run before Job/Run insertion and token reservation. Storage checks run before upload intents, paid admission, output allocation and finalization. Idempotent existing work replays retain their identity. Capacity-blocked Workflow children wait without a new Job or reservation.

Storage usage counts original versions, thumbnails, raw sources, verified artifacts and posters once by object identity. Content references do not duplicate their artifact. Pending intents allocate expected bytes; each unmeasured thumbnail reserves 1 MiB; processing posters reserve 1 MiB. Active paid Jobs conservatively allocate their configured output bounds before reservation (AI default 256 MiB; Clipper target clips × 256 MiB plus 84 MiB transcript/plan). Allocated artifacts replace that projection rather than adding it twice. `bytes` is known sealed storage; `quotaBytes` includes these provisional allocations.

PostgreSQL `auth_rate_limits` persists windows through process restarts. Default 15-minute limits per user/workspace: invitations 30, upload signing 120, quotes/estimates 120, paid submissions 60, Workflow starts 30, payment creation 20, payment polling 300, signed-media issuance 600. Set RATE_LIMIT_<OPERATION> and RATE_LIMIT_WINDOW_SECONDS for reviewed values. Authentication additionally has per-email limits and a production IP limit of 30; loopback test auth uses a higher fixture allowance.

Rejection is HTTP 429 with safe RATE_LIMITED or WORKSPACE_QUOTA and Retry-After. The throttle record persists outside the rejected business transaction; no Job, reservation, Run, Payment or upload intent is created by the rejected operation. This is independent of role authorization and product pricing.
