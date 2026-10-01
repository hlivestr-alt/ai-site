# Durable orchestration

npm run workflow:dispatcher runs scripts/workflow-dispatcher.ts. It polls Postgres in bounded batches of at most 25 due nonterminal Runs, with FOR UPDATE SKIP LOCKED. Each Run is reconciled in a short transaction; no generation, transcription, media processing or remote provider calls happen in this process. Two processes may run safely on the same database.

A tick locks the Run, then the workspace wallet when needed for consistent billing observations and admission. It loads authoritative Jobs, JobBilling, publication intents, ContentVersions and review decisions; repairs missing links from immutable Job lineage; updates logical steps; evaluates stopping/review conditions; and admits at most two new children per Run tick. Due timestamps provide fair repeated polling. Paused runs continue observing already admitted work.

Quote creation/validation, budget check, existing paid admission, child reservation, mapping and Step update share the Run transaction. Crash before commit rolls everything back. A persisted Job with missing mapping is recovered by lineage and stable idempotency, with no second reservation. There is no workflow processing queue or in-memory promise representing a Run.

Waiting review and funds Runs are polled. A review or wallet credit becomes visible on later ticks without browser Resume. All review decisions still use the existing Content service. Automatic transitions append workflow_events; human create/start/edit/control actions append the existing audit_events. Reconciliation logs counts and safe error classes.

There is no workflow health HTTP endpoint in this phase. Process liveness, workflow_tick/workflow_error logs, overdue next_reconcile_at and the authenticated run APIs are the available operational signals. Unexpected tick failures roll back; the next process tick retries from durable state.
