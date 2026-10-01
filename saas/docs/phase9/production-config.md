# Production configuration

Use `APP_ENV=local`, `test`, `staging`, or `production`. Local/test simulation also requires a loopback `APP_BASE_URL`. Staging/production require an HTTPS origin, HTTPS storage endpoint, explicit Workflow ceiling and SMTP configuration. Startup rejects simulation/test flags, fake provider selections, development mailbox mode and diagnostic tokens in staging/production.

Keep separate environment files, DB identities, buckets and credentials. `deploy/production.env.example` contains placeholders only. Launch production processes with `node --env-file=/secure/runtime.env …`; npm shortcuts intentionally default to local development configuration. Never copy a test environment file into deployment.

Required infrastructure: DATABASE_URL, APP_BASE_URL, OBJECT_STORAGE_ENDPOINT/REGION/BUCKET/ACCESS_KEY/SECRET_KEY, WORKFLOW_MAX_TOKENS, MAIL_PROVIDER=smtp, SMTP_HOST/PORT/USER/PASSWORD, MAIL_FROM, and a random 32-byte hex MAIL_ENCRYPTION_KEY. Use authenticated TLS for hosted PostgreSQL, a private network for its endpoint and a bucket-scoped storage identity. Production provider credentials remain separately required for launch acceptance.

BytePlus stays in SaaS; the OpenAI analyzer key stays on the private worker. Set CLIPPER_ANALYZER_CONFIGURED=1 and OPENAI_WORKER_CREDENTIAL_CONFIGURED=1 only after verifying that remote worker's key/model configuration. On a colocated operator host, PRIVATE_WORKER_ENV_FILE can supply a read-only credential-presence check without printing values. Provision CLIPPER_V1 with concurrency 1. Xendit remains sandbox-only: XENDIT_MODE=test, a development key, callback token, business ID and HTTPS return origin. This phase cannot charge production money.

PLATFORM_OPERATOR_USER_IDS or PLATFORM_OPERATOR_EMAILS are explicit allowlists of active accounts. OPS_READINESS_TOKEN must be at least 32 characters. TRUST_PROXY_HEADERS=1 requires the trusted proxy to overwrite forwarded headers; leave it disabled for direct access. Optional AI_VIDEO_ENABLED, CLIPPER_ENABLED, WORKFLOWS_ENABLED and PAYMENTS_ENABLED switches stop new admission while reconciliation remains available.

Run `scripts/operations.ts production-preflight` with the production environment. It reports configured/missing/invalid names and readiness booleans, never values. Production prices/packages require operator-chosen immutable versions; local TEST seed data is insufficient. Verification flags are operator attestations after actual acceptance, never evidence produced by deterministic fixtures.
