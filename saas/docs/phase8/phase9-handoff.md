# Phase 9 handoff — paid beta hardening only

Phase 9 has not begun. No production deployment configuration changes are part of Phase 8.

Supervise Next.js SaaS, existing dispatcher, workflow dispatcher and private Windows worker. Payment reconciliation and poster processing currently run in the existing dispatcher; standalone billing:reconcile and content:reconcile are bounded operator repair tools, not additional always-running services. Monitor workflow_tick/workflow_error and dispatcher logs, overdue due times, uncertain provider states, settlement/publication/poster backlog and stale worker heartbeats. Worker authenticated heartbeat/claim APIs and customer Jobs/Workflow detail APIs exist; dedicated readiness/health/metrics endpoints are still a hardening gap.

Back up the separate SaaS Postgres database (including immutable snapshots, workflow tables, ledger and migration history) and sealed private object storage. Verify coordinated restore, artifact/version retention and source checksum identity. Preserve tenant metadata and encryption/credentials separately. Native databases remain independent.

Operator gaps: admin workflow search/status timelines, safe reconcile controls, stalled gate diagnostics, billing uncertainty support and documented user support procedures. Rate/usage gaps: per-workspace active-run/admission limits, API rate limits, object/storage retention quotas and operational metrics with alerts. Current bounds are 5 prompts, 3 videos per prompt, 20 intended-child engine guard, Clipper limits, configured workflow token ceiling and bounded tick batches; they are not a complete beta quota policy.

Review source/reference/output/poster lifecycle and cleanup retention for workflow/review references. Production email delivery still needs a real mail provider and recovery verification. Production requires approved pricing/packages, explicit workflow ceiling, independently configured providers, supervised services, private storage, backup/restore evidence and terms/retention policy.

Remaining real acceptance: BytePlus Seedance generation, real OpenAI analyzer, Xendit sandbox payment creation/webhook/query and operational recovery. Phase 8 intentionally uses fake/deterministic paths and cannot certify those integrations. Do not start those real-provider calls or Phase 9 deployment as part of this task.
