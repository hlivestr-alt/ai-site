# Persistent jobs, provider adapters, and private worker protocol

The browser is never a worker. A Postgres transaction creates Job + immutable input/product/price snapshots + token reservation + outbox intent. A dispatcher claims outbox/job rows with `FOR UPDATE SKIP LOCKED`, bounded concurrency and per-provider/worker capacity; it can restart and rescan. Redis may later accelerate wakeups, but Postgres remains authority. `QUEUED`, `WAITING_FOR_WORKER`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED` are customer states; `RECONCILING` is justified internally for ambiguous provider/lease outcomes. Distinguish attempt state from job state.

## Worker contract (future endpoints, not implemented)

1. Provision a worker identity and rotatable credential from admin; authenticate each outbound TLS call with a short-lived token or mTLS. `POST /worker/register` reports worker ID, agent/pipeline/model versions, capabilities (transcribe, clip styles, codecs), GPU/CPU/memory and concurrency; server returns config version.
2. `POST /worker/heartbeat` reports capacity, active lease IDs, health and version every ~15–30 s. Mark offline after missed windows; do not cancel work solely because one heartbeat is lost.
3. `POST /worker/claim` atomically selects capability-compatible `WAITING_FOR_WORKER` job, reserves capacity, and returns job ID, attempt, **fencing token**, lease expiry (e.g. 2 min), immutable input snapshot and short-lived signed object access. No other worker can claim until lease expiry/reconciliation.
4. `POST /jobs/:id/progress` and `POST /worker/leases/:id/renew` require matching worker, attempt and fencing token; progress is monotonic within attempt, with stage and sanitized message. Renew before expiry; no side effect from duplicate progress sequence IDs.
5. Worker downloads/verifies source checksum to an isolated job directory; runs local transcription → transcript analyzer → validated clip plan → FFmpeg/captions → probes/hash checks → uploads each result to pending object keys. `POST /jobs/:id/complete` sends manifest, checksums, object IDs and stage versions; server validates all objects and atomically creates content versions and job success/capture. A repeated completion returns the existing result.
6. `POST /jobs/:id/fail` sends a safe error code, retriable flag and diagnostic reference. Retriable failures return to queue with backoff and attempt cap; definitive failures release reserve. Logs are redacted, size-limited and uploaded to a restricted admin object, not customer content. Never transmit model credentials or raw local paths.

Expired lease: mark worker offline/attempt uncertain, fence old token, inspect output manifest and job checkpoint. Requeue only if the stage can resume or be rerun without duplicate external cost/output; otherwise hold `RECONCILING` for support. A late old worker completion cannot change state or charge. Worker concurrency is advertised slots, not number of HTTP calls; GPU-heavy transcription/LLM and FFmpeg CPU slots have separate limits. A worker can drain, finish active leases, then upgrade. Version/capability mismatch blocks claim.

## AI video provider contract

`VideoProvider.capabilities()`, `quote(input)`, `submit(input, idempotencyKey)`, `poll(externalId)`, `cancel(externalId)?`, `retrieve(externalId)`, `normalizeProgress(raw)`, `mapError(raw)`. A `ProviderExecution` persists request hash, provider/model/version, external ID, attempt, raw-safe state, cost and last poll. Route Fast/Quality/Premium from internal configuration and a pinned policy version. Capability validation happens **before** quote/reserve. Never let provider callback text or a client supplied provider name determine billing. Callback and poll converge on one idempotent transition under row lock. On timeout, reconcile by idempotency key/external ID before any resubmit. Cancel is best effort; charge/refund follows the published rule and actual provider outcome.

## Retry/cancel semantics

- Same `(workspace,type,idempotency_key)` and same input hash returns the original job; different input conflicts. Double click/two tabs/devices share this DB invariant.
- Queue dispatch is at least once; each external submission uses stable provider request key or a persisted `SUBMISSION_UNKNOWN` state. Do not submit a second billable execution merely because HTTP timed out.
- One output object/content version per job result identity; unique callbacks/event IDs. Partial batch results are child jobs with individual reserves/captures; parent aggregates success/failure.
- Cancellation before dispatch releases full reserve. During execution, request provider/worker cancel, then reconcile actual cost/outcome; do not release until definitive. Pausing a workflow stops new children but does not cancel already running children.
