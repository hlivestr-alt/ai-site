# Failure and recovery contract

`R` = existing reservation stays held pending reconciliation; `C` = capture once after durable result; `L` = release once after definitive failure. Support uses admin views of job/attempt/lease/object/payment/ledger, never direct SQL as the normal recovery UI.

| Scenario | Expected state and automatic recovery | Billing | Support action if unresolved |
| --- | --- | --- | --- |
| Website restart | Postgres job/outbox persists; dispatcher resumes; browser reload reads state | R/C/L unchanged | Check outbox lag |
| DB restart | API/dispatch pause; reconnect and scan committed outbox | No new reserve until transaction commits | Restore DB/PITR if unavailable |
| Worker offline | Heartbeats age; stop new claims, leases become uncertain | R | Inspect worker/lease and queue |
| Worker crashes mid-job | Lease expires; checkpoint/object probe before safe requeue | R until known | Review temp outputs if ambiguous |
| Lease expires while worker still running | Old fencing token rejected; claim only after reconciliation | R | Inspect competing attempts, quarantine orphan |
| Provider timeout on submit | `RECONCILING`, query by stable request key/external ID; no blind resubmit | R | Ask provider for authoritative outcome |
| Provider callback twice | Event unique key and row lock make second no-op | C once | None unless event mismatch |
| Provider succeeds after client HTTP timeout | Callback/poller finds same execution and ingests output | C once | Reconcile if external ID missing |
| Storage upload interrupted | Pending object/version; retry same upload or sweep after TTL | R while job active, L if definitive | Inspect multipart/pending object |
| Clipper render fails | Retry stage from validated checkpoint within attempt cap | R during retry, L on terminal fail | Inspect safe diagnostics/source codec |
| LLM moment selection fails | Retry bounded transient errors; invalid/no candidates is explicit failure | R then L | Review transcript/policy/provider |
| Payment webhook twice | Unique provider event ID, verify signature/status, one wallet credit | Purchase once | Compare provider status/event |
| Two jobs race for remaining balance | Wallet row lock serializes reserves; second gets insufficient balance | First R, second no entry | None |
| User double-clicks / two tabs | Same idempotency key+hash returns same Job; changed hash conflicts | One R | Investigate client key misuse |
| User refreshes during submission | Query by idempotency key/run; return committed job | R if committed | Check unknown response/log ID |
| Browser closes | Server/worker continues; later GET shows state | R/C/L normally | None |
| Job succeeds but status update fails | Worker repeats same completion; object manifest and external ID reconciler detects result | R then C once | Publish verified orphan or quarantine |
| Cancellation before dispatch | Job terminal, outbox removed/ignored | L | None |
| Cancellation while running | Best-effort provider/worker cancel, wait for outcome; do not prematurely release | R, then C or L per published rule | Review disputed cost |
| Partial batch completion | Child jobs settle independently; parent records mixed state | C successes, L failures | Reconcile each child |
| Payment return page lost | Browser reads payment from server; webhook/status poll finalizes | Credit only on confirmed payment | Query provider order |
| Late success after released reserve | Quarantine output; no automatic unexpected debit | No silent charge | Decide refund/free output under policy |

Retry scheduling has exponential backoff, jitter, max attempts and an operator dead-letter view. Daily reconciliation compares Postgres intent, external provider state, object existence, content rows and ledger. Alerts cover stuck reservations, overdue leases, callback gaps, payment mismatch and negative projection (which should be impossible). Manual actions are audited and idempotent.
