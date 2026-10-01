# Restart and crash recovery

All workflow authority is Postgres. Next.js can restart or the browser can close without losing Run/Step/child identities. The workflow dispatcher and existing execution dispatcher can stop/restart independently. Waiting review/funds survive; later decisions or credits continue the same Run.

The Run start transaction saves frozen input, deterministic steps and creation event. Child admission/quote/reservation/mapping/step update is one transaction. Abrupt reconciler exit at AFTER_READY or AFTER_ADMISSION rolls back uncommitted work; a later process admits exactly one intended child. Private test hooks live only in the isolated test helper, not customer routes or normal dispatcher configuration.

Stable Job identity and one Job per step additionally recover an already admitted child if its mapping is absent. Completion and exact review binding are idempotent inserts; repeated ticks do not add ledger movements. Provider submission tokens/ProviderExecution and private worker leases/fencing/retries remain the Phase 3–7 authorities.

npm run test:workflow-restart kills and restarts real local app, workflow and execution processes in the isolated test database/bucket. It checks snapshots, step IDs, prior child/reservation identities, four unique provider submissions, durable review waits and low-balance restart/top-up. The browser acceptance closes the entire browser context while both dispatchers finish work. The deterministic Clipper integration terminates a fixture worker process after its claim, expires its lease, starts a replacement fixture worker process and completes the same child under a second fenced attempt without transcription/GPU work.

Recovery does not delete artifacts, fabricate success, re-run uncertain providers or rewrite billing. A version unavailable review gate safely fails instead of guessing a replacement.
