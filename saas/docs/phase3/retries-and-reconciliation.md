# Failure, retries, and reconciliation

The fixture Job allows at most three attempts. A worker may report a short safe error code/message and a retriable flag. Retriable fixture errors schedule a new attempt and outbox row with exponential backoff, starting at `JOB_RETRY_BASE_MS` (default 5000 ms, minimum 1000) and capped at 300000 ms. The dispatcher waits for the outbox availability time. Definitive errors or exhausted attempts fail the Job. There is no token or payment settlement in Phase 3.

The dispatcher also scans expired active leases with `FOR UPDATE SKIP LOCKED`. It fences the old lease, marks the attempt `LOST`, records `LEASE_EXPIRED`, and either cancels a requested cancellation or schedules the fixture retry. For future operations with uncertain external side effects, `scheduleRetry` uses `RECONCILING` instead of blind retry; a type-specific reconciler must be built in that later phase. The current deterministic fixture is safe to repeat on a new attempt.

Worker offline status does not immediately expire work. Lease expiry governs recovery. Operators can inspect attempts, lease deadlines, and retry state using `worker:admin status` and the local database; only safe failure text is exposed to customers.
