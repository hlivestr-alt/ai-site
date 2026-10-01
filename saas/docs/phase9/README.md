# Phase 9: paid-beta hardening

Operational controls over the Phase 1–8 platform. Job execution, immutable snapshots, the wallet/ledger, verified Payments, Content publication and controlled Workflow templates retain their existing authority. No Phase 10 capabilities are included.

Start with [production configuration](production-config.md), [deployment runbook](deployment-runbook.md) and [paid-beta checklist](paid-beta-checklist.md). Deterministic acceptance and external launch acceptance are separate gates; see [final report](final-report.md).

Operator references: [supervision](process-supervision.md), [health/readiness](health-readiness.md), [logging/alerts](logging-and-alerts.md), [quotas/rate limits](quotas-and-rate-limits.md), [storage](storage-operations.md), [backup/restore](backup-and-restore.md), [support](admin-support.md), [mail](email.md), [security](security-review.md), [external acceptance](external-acceptance.md).

From the `saas` directory:

```powershell
npm run db:status
npm run preflight:external
npm run operations -- readiness
npm run operations -- audit
npm run test:phase9
npm run test:unit
npm run test:browser
```

`test:phase9` creates distinct PostgreSQL databases and private buckets for source and restore. It uses fake paid providers and CPU media fixtures. Its evidence is stored in ignored `data/phase9/`; databases/buckets are retained for inspection, never substituted for normal development or production services.

Migration `0009_paid_beta_hardening.sql` adds workspace limits, process heartbeats, measured object observations, backup records and encrypted mail deliveries, plus a deduplicated object-reference view. Migrations 0001–0008 remain unchanged.
