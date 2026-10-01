# Phase 7 — token accounting and sandbox payments

Only the customer SaaS changes. No Workflow Engine, subscriptions, Outreach billing, or production payments.

Read [wallet](wallet.md), [ledger](token-ledger.md), [pricing](pricing.md), [quotes](quotes.md), [job billing](job-billing.md), [payments](payments.md), [Xendit](xendit.md), [reconciliation](reconciliation.md), [isolation tests](isolation-tests.md), and [handoff](phase8-handoff.md). Acceptance evidence and commands are in [final report](final-report.md).

Migration `0007_billing_tokens.sql` adds wallet, catalog/version, quote, job billing, ledger, package/version, payment, payment event, fake provider state, and reconciliation issue tables. Migrations 0001–0006 remain unchanged. Existing jobs are grandfathered LEGACY; newly created SYSTEM_TEST jobs are DIAGNOSTIC, and new customer AI Video/Clipper jobs are PAID. New workspaces start at zero.

Local setup requires `APP_ENV=local`, `ENABLE_TEST_BILLING=1`, explicit `npm run billing:seed:test`, and the explicitly enabled fake providers. Use a long random `FAKE_PAYMENT_WEBHOOK_SECRET` kept in environment configuration. No runtime code silently seeds prices or grants tokens. `.env.example` keeps simulation/support flags disabled.
