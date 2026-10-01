# Reconciliation and recovery

Run `npm run billing:reconcile` to report wallet versus ledger projection, reserved total versus RESERVED JobBilling, terminal missing settlement, capture without success, purchase without PAID/refunded Payment, PAID without purchase, package/payment mismatch and late success after release. Issues retain safe IDs and stable issue keys.

`npm run billing:reconcile -- --repair-safe` attempts only normal validated job settlements and authoritative payment queries before producing the report. It never changes historical ledger rows, resets wallet projections, fabricates artifacts, re-submits an unknown job, or retries an ambiguous payment create. Successful sealed jobs and definite failed/cancelled jobs can recover an omitted capture/release using stable identities.

The continuously running dispatcher settles terminal billing and queries pending/known uncertain payments. Wallet locks are per workspace, payment locks are per payment, and no giant global billing lock is used. Unknown outcomes have no automatic maximum-age release. Missing external identity after ambiguous real creation requires provider/dashboard investigation or an authenticated matching webhook.

Run support corrections only with an operator identity, reason and stable key. A fiat refund/chargeback after tokens were spent remains a financial support issue; never force a wallet negative or turn it into a negative purchase.
