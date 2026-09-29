# Phase 3: persistent Job platform

Phase 3 adds the durable execution path for future SaaS operations. A customer request creates a Job, frozen input, an initial attempt, and an outbox row in one Postgres transaction. A separate dispatcher moves valid Jobs to `WAITING_FOR_WORKER`; a private outbound-only Python agent claims deterministic fixture work through authenticated worker APIs. Browser requests never run the fixture.

Start with [local-development.md](local-development.md). The schema is migration `0003_jobs_workers.sql`. The implementation lives in `src/lib/jobs.ts`, `job-core.ts`, `worker-core.ts`, `scripts/dispatcher.ts`, and the separate `../worker-agent` project. Only `SYSTEM_TEST` has an executor in this phase; other Job types are schema placeholders for later phases.

Contract details: [jobs.md](jobs.md), [job-states.md](job-states.md), [outbox-dispatcher.md](outbox-dispatcher.md), [workers.md](workers.md), [leases-and-fencing.md](leases-and-fencing.md), [retries-and-reconciliation.md](retries-and-reconciliation.md), [worker-media-access.md](worker-media-access.md), [phase4-handoff.md](phase4-handoff.md).
