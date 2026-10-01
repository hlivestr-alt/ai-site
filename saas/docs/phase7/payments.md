# Payments and top-ups

Immutable package versions fix token amount, integer fiat minor amount, and currency. Payments use the stored active package version; browser amounts or final statuses are ignored. All new workspaces have zero tokens.

Owner/Admin can create top-ups and view checkout/payment history. Editor can spend and view wallet, token history and job usage. Viewer can read wallet/usage/history but cannot quote, spend or purchase. Workspace selection and active membership are checked, and mutation roles are rechecked in the transaction.

The provider-neutral interface covers createPayment, getPayment, verifyWebhook, parseWebhook and optional refundPayment. Local CREATING Payment is committed before any provider call. Its reference is `topup_<payment UUID>`. A persisted creation claim permits one external create. Repeated requests reuse the same payment identity. An ambiguous create leaves creation_unknown for support; it is never blindly recreated. Known external IDs can be queried. The fake provider also recovers its deterministic ID after a lost response.

Normalized payment states are CREATING, PENDING, PAID, FAILED, EXPIRED, REFUNDED. A verified late PAID event may credit an expired/failed original Payment if all immutable identities match; PAID/REFUNDED never regress on stale pending/expiry events. Session failure attempts are not treated as failed sessions.

Webhook route bounds raw bodies to 64 KiB, authenticates before JSON interpretation, and stores only normalized IDs/status/amount/currency and their canonical hash. Provider/event identity is unique. Payment row locking serializes concurrent callbacks. Verified PAID, PURCHASE ledger, wallet projection, event and audit commit together. Credit failure rolls everything back, and authoritative query reconciliation recovers it.

Unknown payment, amount/currency/business/external identity mismatch, or conflicting event identity creates a support issue and never credits. Browser checkout return parameters never mutate accounting. Fake simulations require local TEST flags and a separate durable provider-truth table. Their signed callbacks and query results use the same payment processor as Xendit. Fake fiat refunds record a support issue and leave token accounting unchanged. They do not create a token refund or automatically claw back spent funds.

Payment history and token ledger history have stable created-at/ID cursors, preserving PostgreSQL microsecond timestamps. Owner/Admin can load older payments; Editor/Viewer never receive the payment history payload.
