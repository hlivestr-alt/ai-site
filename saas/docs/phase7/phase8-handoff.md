# Phase 8 contracts — no Workflow implementation here

Workflow child Jobs may call the same server quote and paid-operation services. Each child needs a stable workspace/type/request key and a valid quote bound to its frozen inputs. Atomic reservation is the only authority to admit work; scheduling estimates or displayed balances cannot guarantee admission.

Treat 402 as insufficient funds and 409 expired/stale quotes as requiring a new quote. Do not create a child job, provider attempt or task outbox before reservation succeeds. Resume blocked scheduling only after funds/inputs are available, using the same intended operation identity. Do not reserve or charge again for a retry of an admitted Job.

Use JobBilling plus ledger references for usage. CAPTURED means successful paid execution; Content/review state is a separate lifecycle. RELEASED means the original execution was definitely failed/cancelled at settlement time. RECONCILING and SUBMISSION_UNKNOWN retain their reservations and must not be retried as new jobs. REFUNDED does not change the successful execution identity.

Production prices/packages and real Xendit sandbox acceptance remain deployment prerequisites. Payment creation/webhook/query services are reusable. Customer redirects cannot credit wallets. No Workflow Engine, parent workflow charge, subscription or Outreach billing was added in Phase 7.
