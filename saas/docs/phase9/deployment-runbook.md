# Paid-beta deployment runbook

This is an operator runbook, not an executed deployment. Choose an independent commercial SaaS domain, a host for the web app/dispatchers, dedicated SaaS PostgreSQL and a private S3-compatible bucket. Keep internal AI Site, H3 Bridge, Creative Studio, native Clipper and Outreach services/databases outside this deployment. The private Windows worker remains outbound-only.

## Provision and configure

1. Create a dedicated service account, private database/network access, protected runtime/backup directories, and restricted log access. Install a supported Node runtime compatible with the checked-in package, matching PostgreSQL client tools and FFmpeg/ffprobe for SaaS media verification/posters. Use `npm ci` in `saas`. Do not ship `.env.local`, local backups, fixture receipts or test outputs.
2. Provision a private bucket and scoped storage identity. Review HTTPS endpoint, region, block-public-access policy, encryption/versioning, capacity and backup retention. Configure CORS for the exact SaaS HTTPS origin, GET/PUT/HEAD and required upload headers. Complete the vendor checklist in [storage operations](storage-operations.md); local fixtures do not certify a vendor.
3. Store values from `deploy/production.env.example` in a protected runtime file/secret store. Set APP_ENV=production, the final HTTPS origin, SMTP and mail encryption key, explicit operator allowlist/readiness token, and a deliberate WORKFLOW_MAX_TOKENS ceiling. Keep feature switches off during preparation. Keep all fake/test/diagnostic flags off. Keep the OpenAI key on the private worker.
4. Terminate TLS at a trusted reverse proxy/Cloudflare-compatible front end. Forward to the loopback Next listener; overwrite forwarded headers before enabling TRUST_PROXY_HEADERS. Restrict the backend port/network. Expose authenticated provider callbacks only at their documented public HTTPS paths. The worker PC needs no public port, inbound tunnel or SaaS-initiated connection.

## Release and migrate

Load the selected runtime explicitly for every direct command. Npm operator shortcuts default to `.env.local` and are intended for local operation.

```sh
node --env-file=/etc/ai-site-saas/runtime.env scripts/migrate.mjs status
node --env-file=/etc/ai-site-saas/runtime.env --import tsx scripts/backup.ts create /var/backups/ai-site-saas/reviewed-new-backup
node --env-file=/etc/ai-site-saas/runtime.env --import tsx scripts/backup.ts verify /var/backups/ai-site-saas/reviewed-new-backup
node --env-file=/etc/ai-site-saas/runtime.env scripts/migrate.mjs up
node --env-file=/etc/ai-site-saas/runtime.env scripts/migrate.mjs status
node --env-file=/etc/ai-site-saas/runtime.env node_modules/next/dist/bin/next build
```

For a genuinely blank database there is no existing application data to back up: record that fact, apply migrations, then create and verify the first coordinated backup. The Phase 9 backup tool requires the Phase 9 object-reference view; an existing pre-0009 deployment must take its existing pg_dump plus private object snapshot before applying 0009. Do not skip this pre-upgrade backup because the new backup tool is unavailable.

Check every migration checksum. Never edit 0001–0008 or roll back by replacing migration files. If a deploy fails, pause admission, retain evidence and recover an isolated environment using [backup and restore](backup-and-restore.md); authorize cutover after financial/media checks. A restored database is not permission to resubmit uncertain external work.

## Start and inspect

Review the supplied systemd templates or a Windows service-wrapper configuration, including executable paths, service account, environment access, log rotation and 300-second drain allowance. Install supervision only during the deployment itself. Start web, readiness, execution dispatcher, Workflow dispatcher and the private worker in that order. See [process supervision](process-supervision.md).

On the worker, use a Python 3.11+ virtual environment and the pinned/installed dependencies described by `worker-agent/README.md` and Phase 5. Provision a separate CLIPPER_V1 credential with concurrency 1; capture its one-time output directly into its protected environment. Configure CUDA/local Whisper, FFmpeg, OpenAI model/key, disk budget and terminal retention. Start `python worker_agent.py` from `worker-agent`; Ctrl+C drains. For upgrade/rotation, stop new claims, drain, retain checkpoints, update/restart and verify the same leased Job lineage. Never connect the native Clipper DB to this worker.

```sh
node --env-file=/etc/ai-site-saas/runtime.env --import tsx scripts/operations.ts readiness
node --env-file=/etc/ai-site-saas/runtime.env --import tsx scripts/operations.ts status
node --env-file=/etc/ai-site-saas/runtime.env --import tsx scripts/operations.ts audit
node --env-file=/etc/ai-site-saas/runtime.env --import tsx scripts/operations.ts external-preflight
node --env-file=/etc/ai-site-saas/runtime.env --import tsx scripts/operations.ts production-preflight
```

Liveness must stay lightweight; internal readiness must validate config, DB, migration checksums and storage. Confirm both dispatcher/subservice ticks, compatible worker/GPU/disk health, clean accounting and current backup/restore evidence. Operator status access requires an explicitly allowlisted active account; customer workspace roles confer no operator access.

## Price and external acceptance

Prepare a reviewed JSON catalog with realm PRODUCTION, immutable AI_VIDEO QUALITY and CLIPPER price versions and at least one active Token package. Use operator-chosen amounts; there are no automatic production prices. The current Xendit adapter supports IDR sandbox checkout and refuses live keys. Temporarily enable ENABLE_BILLING_SUPPORT_CLI, use the catalog command with an allowlisted active operator, a reason and stable idempotency key, then disable the CLI flag. Existing versions cannot be overwritten.

```sh
node --env-file=/etc/ai-site-saas/runtime.env --import tsx scripts/billing-catalog.ts /secure/reviewed-catalog.json OPERATOR_UUID "Reviewed beta pricing" stable-catalog-key
```

Verify SMTP delivery with a controlled operator address, links pointing to the final domain, TLS and sender deliverability. Then follow [external acceptance](external-acceptance.md) for one intentional BytePlus Job, one short OpenAI Clipper flow and one Xendit sandbox purchase. Enable only the required feature during its controlled check. Record actual evidence before setting acceptance attestations. Do not replace missing providers or use fake results as acceptance.

## Cutover and daily operation

Complete [paid-beta checklist](paid-beta-checklist.md), enable the reviewed features, rerun production preflight and smoke-test sign-in, Product/Content/Billing/Workflow history, fresh private media and operator recovery. Confirm real storage/multipart handling before raising the source-size cap. Maintain a small invitation-based cohort and conservative quotas.

Daily: inspect actionable alerts, run read-only accounting/Job/Workflow/Content audits, verify mail/payment/publication/poster ticks and disk capacity, create a protected coordinated backup and verify it. Run periodic isolated restore drills, retain evidence and record the completed checklist through the audited restore-receipt command in [backup and restore](backup-and-restore.md). Pause new admission with feature switches during incidents while reconciliation continues. Investigate unknown provider/payment outcomes by existing identities; never force success, approval, payment paid state or wallet balances.
