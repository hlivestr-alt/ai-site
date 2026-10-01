# Job billing lifecycle

Every new customer AI_VIDEO/CLIPPER request, including normal deterministic fake providers, reserves its quote amount. One JobBilling record owns the immutable quote, price version, amount and ledger references. Allowed states: RESERVED → CAPTURED or RELEASED; CAPTURED → REFUNDED. Retries never create another JobBilling or RESERVE.

`settlementBatch` is durable work derived from RESERVED JobBilling and terminal Jobs. The dispatcher calls it after provider execution and before Content publication. It can recover after restart without an in-memory callback. Direct queued customer cancellation also attempts settlement after committing cancellation, using the same wallet-first accounting helper.

Capture requires authoritative SUCCEEDED, a complete distinct READY artifact manifest belonging to the current successful attempt, and a durable Content publication intent. Publication, Content versions, posters, review, download, archive, restore and variant relations have no charge. Publication retries reuse the successful job and artifacts.

Definite FAILED/CANCELLED releases once. Running cancellation requests retain reservations until execution confirms a terminal outcome. SUBMISSION_UNKNOWN/RECONCILING and active uncertain provider executions retain funds; no age-based release or new submission is introduced. Clipper attempt/render checkpoint reuse retains one parent reservation. AI retry after a confirmed failed submission retains one parent reservation.

Late success after RELEASED records LATE_SUCCESS_AFTER_RELEASE. It never re-reserves or captures tokens. Content publication, approval eligibility and job artifact downloads are quarantined for that released job. An operator must investigate. Never treat a release as permission to charge again.

SYSTEM_TEST is free DIAGNOSTIC. Existing privileged diagnostic AI endpoint remains free and clearly separated. Local normal API testScenario controls are gated by TEST billing and fake provider flags and still bill through the normal service.
