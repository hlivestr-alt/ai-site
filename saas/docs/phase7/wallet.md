# Workspace wallet

One wallet per workspace, including backfilled workspaces. A database workspace-insert trigger creates a zero wallet in the workspace transaction. Available and reserved balances are BIGINT, nonnegative, and exposed as decimal strings. Application arithmetic uses bigint.

The ledger is authoritative. An AFTER INSERT ledger trigger locks the workspace wallet, validates the cause and sign, and applies both deltas in the same transaction. Direct wallet projection edits and deletes are blocked; starting balances must be zero. Ledger conflicts do not apply a second projection update.

Customer submission locks only its own wallet, rechecks the idempotency identity and quote, checks available funds, and inserts Job, attempt, outbox, JobBilling and RESERVE in one transaction. A failure at any step rolls back all of them. Payment processing locks its payment before its wallet; job accounting never locks payments, so there is no reverse edge.

Billing and Home display the projection. Reconciliation independently sums ledger deltas and compares outstanding JobBilling reservations. It reports drift and never silently resets balances.

All Product, workspace membership and provider-policy reads during admission use the same transaction connection. The ten-fresh-request acceptance fills the pool deliberately; reservation never waits for another pooled connection while holding a transaction or wallet lock.
