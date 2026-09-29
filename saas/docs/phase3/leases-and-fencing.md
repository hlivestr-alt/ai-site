# Leases and fencing

A claim transaction checks capability, active workspace, available capacity, heartbeat freshness, and frozen media. It selects a waiting Job with `FOR UPDATE OF j SKIP LOCKED`, marks its attempt and Job running, and inserts one active lease. The DB partial unique index permits only one active lease per Job. Each lease gets a monotonically increasing database sequence fencing token. Default duration is 120 seconds, configurable with `WORKER_LEASE_SECONDS` (clamped to 30–600).

Every mutating worker callback supplies Job ID, attempt ID, lease ID, and fencing token, in addition to bearer authentication. The server locks and checks that the lease belongs to that authenticated Worker, has the current token, remains active, and has not expired. Renewal extends the deadline and reports cancellation. Progress, failure, completion, output slot allocation, and signed media access use the same identity check. The server rejects late callbacks with 409 after expiry or reconciliation.

If a worker stops, the reconciler marks the old lease `EXPIRED` and attempt `LOST` before scheduling a safe fixture retry. A restarted agent claims a new attempt and token; the old worker cannot overwrite its state. Completion from the same successful lease is idempotent. A cancelled Job cannot be completed successfully.
