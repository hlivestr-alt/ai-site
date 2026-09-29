# Jobs and frozen input

`jobs` is the customer-visible record; `job_attempts` records each execution. `job_events` holds safe lifecycle events. `job_artifacts` holds temporary output staging, not Content Library items. Every child row carries `workspace_id` with composite foreign keys where applicable.

The internal creation contract is `createDiagnosticJob` → `insertJob`. The diagnostic route requires local `APP_ENV`, a 32+ character diagnostic token, an authenticated OWNER or ADMIN, and same-origin request. It is not a normal customer creation API. Future operations should add type-specific authenticated creation services that use `insertJob` inside a transaction; they must never accept arbitrary Job types from the client.

Creation requires an idempotency key. Unique `(workspace_id,type,idempotency_key)` enforces one intent. A repeated key with the same input hash and capability returns the existing Job; changed input returns 409. The DB trigger prevents mutation of the stored input, identifiers, hash, key, creator, or capability after creation. The snapshot contains no worker token, customer session, or signed URL.

For a Product-backed Job, `getProductSnapshot` is called under the creation transaction while the Product row is locked. The saved JSON records exact ProductVersion and AccuracyRuleVersion IDs and numbers, information, rules, selected Asset/AssetVersion IDs, checksum, size, MIME type, and private storage key. Later Product pointer edits do not rewrite the Job. Workers receive `safeWorkerInput`, which removes storage keys; media access uses version IDs under the current lease.

Authenticated customer APIs list, detail, and cancel workspace Jobs. Lists, counts, attempts, and events are workspace scoped. The UI at `/jobs` and `/jobs/[jobId]` shows real status, progress, and safe error text. It does not expose worker credentials or fencing data. A queued or waiting Job cancels immediately; a running Job gets `cancel_requested_at` for cooperative cancellation.
