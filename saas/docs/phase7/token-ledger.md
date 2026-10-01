# Append-only token ledger

| Entry | Available delta | Reserved delta | Cause |
|---|---:|---:|---|
| PURCHASE | +amount | 0 | PAID stored Payment |
| PROMOTIONAL_GRANT | +amount | 0 | Operator and reason |
| RESERVE | -amount | +amount | Validated Quote and Job |
| CAPTURE | 0 | -amount | Successful Job and publication intent |
| RELEASE | +amount | -amount | Definite failed/cancelled Job |
| REFUND | +captured amount | 0 | Captured Job, operator and reason |
| ADMIN_ADJUSTMENT | signed amount | 0 | Operator and reason |

Balances are the sums of available_delta and reserved_delta. Capture removes a hold; it does not debit available tokens again. Release restores availability. No balances may become negative.

Database triggers reject ledger UPDATE/DELETE, wrong signs, wrong JobBilling amounts, workspace mismatches, and purchases without PAID payments. Foreign keys are scoped by workspace. A workspace idempotency key is unique; partial indexes permit one reserve/capture/release/refund per Job and one purchase per Payment. Deferred constraints require ledger references before commit.

Support mutations have no customer endpoint. Enable `ENABLE_BILLING_SUPPORT_CLI=1` only for a trusted operator process. Run `billing-support.ts grant|adjust|refund workspaceId operatorUserId stableKey amount|jobId "reason"`. It validates an active user identity, reason and request key, locks the wallet, checks replay equivalence, and writes the ledger plus audit atomically. Workspace Admin is not a support operator by virtue of its customer role. Token refunds are full captured-job refunds, once per job.
