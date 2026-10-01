# Conditional external acceptance

BytePlus, OpenAI analyzer and Xendit sandbox credentials are currently absent. This phase made **zero** real calls/payments. SMTP and production object storage acceptance are also pending. The deterministic result is independent of these launch gates. Do not substitute a provider or automatically repeat an expensive acceptance attempt.

## Safe preflight

Run `npm run external:preflight` locally, or `node --env-file=/secure/runtime.env --import tsx scripts/operations.ts external-preflight` with the intended environment. Output contains booleans only. BytePlus and Xendit settings are consumed by SaaS. OpenAI settings belong to the private worker; on a colocated operator host the command can read PRIVATE_WORKER_ENV_FILE (default `worker-agent/.env`/`.env.local`) without displaying its contents. For a remote worker, verify its OpenAI key/model privately and attest OPENAI_WORKER_CREDENTIAL_CONFIGURED=1 and CLIPPER_ANALYZER_CONFIGURED=1 in SaaS. Attestation is a manual deployment assertion, not a key discovery or an external acceptance result.

Use a dedicated controlled staging/production-like workspace, private bucket, operator-chosen pricing and a funded normal wallet. Keep every fake/test flag disabled. Record safe workspace/Job/attempt/provider/payment/Content IDs, exact intended count, timestamps and relevant hashes. Secrets, complete signed URLs, prompts/uploads and raw provider responses do not belong in the report.

## Exactly one BytePlus Seedance Job

Required: VIDEO_PROVIDER=byteplus, BYTEPLUS_ARK_API_KEY, reviewed BYTEPLUS_ARK_BASE_URL, active QUALITY provider policy/model, AI_VIDEO_ENABLED=1, normal AI_VIDEO price and wallet balance. Public/trusted reference retrieval must work through short-lived private media URLs. Run safe production preflight before enabling a controlled attempt; incomplete unrelated gates remain explicitly pending.

1. Create one test Product/reference whose rights are established. On AI Video, choose QUALITY, one output and the shortest supported duration/aspect ratio. Review the normal quote; submit once with the same request identity on any status refresh.
2. Observe one Job, one reservation, one ProviderExecution, submit_count=1 and one external task ID. Poll the same task; verify output SHA/size, sealed private artifact, one capture, Content publication and preview/review access.
3. Confirm unsigned access is denied, foreign-tenant signing is denied and no second Job/task/ledger reservation exists. Inspect the read-only billing/Content audit.
4. On SUBMISSION_UNKNOWN/RECONCILING or a lost submit response, retain identity and stop the acceptance attempt. Query/support only; do not blind resubmit. Retry ingest/publication of an existing verified result through existing recovery semantics.

After actual evidence passes, set BYTEPLUS_ACCEPTANCE_VERIFIED=1. A key's presence or local FakeVideoProvider output is insufficient.

## Exactly one short OpenAI Clipper flow

Required on the private worker: CLIP_ANALYZER_PROVIDER=openai, OPENAI_API_KEY, explicit OPENAI_CLIP_MODEL, installed local Whisper/CUDA and FFmpeg, healthy CLIPPER_V1 credential/concurrency 1, disk budget. Required on SaaS: CLIPPER_ENABLED=1, CLIPPER_ANALYZER_CONFIGURED=1, a normal CLIPPER price and wallet balance. No public worker port is used.

1. Upload one small controlled MP4 source. Choose one target clip and a supported short duration; submit one normal quoted Clipper Job.
2. Verify local transcription, a real structured TranscriptAnalyzer flow, validated candidates/plan, local rendering, private clips, completion fencing, capture and Content publication. A sufficiently short transcript should fit one analysis chunk; record actual request count, model and usage rather than assuming it.
3. Verify source/clip hashes and lineage, media preview, review and a clean financial audit. Preserve safe attempt/plan identities.
4. Stop for investigation on an uncertain/error outcome; do not switch to fake analysis or run another acceptance Job automatically. Existing local transcript/plan/render checkpoints govern safe recovery.

After actual evidence passes, set OPENAI_ACCEPTANCE_VERIFIED=1. Local CPU fixtures do not prove real transcription/model quality/GPU throughput or external analyzer availability.

## Exactly one Xendit sandbox purchase

Required: PAYMENT_PROVIDER=xendit, XENDIT_MODE=test, XENDIT_SECRET_KEY with the development-key prefix, XENDIT_CALLBACK_TOKEN, XENDIT_BUSINESS_ID, XENDIT_RETURN_BASE_URL at the final public HTTPS origin, PAYMENTS_ENABLED=1 and an active reviewed IDR sandbox-compatible package. Configure authenticated events at `/api/webhooks/xendit`. Live keys/production money are refused by this adapter.

1. On Billing, select one package and create one Payment using one stable request identity. Verify one local reference and one external sandbox session/checkout URL; complete sandbox checkout once.
2. Verify webhook authentication, business/amount/currency/reference identity and query reconciliation for the same session. Returning from checkout must not independently credit tokens.
3. Confirm exactly one PURCHASE ledger entry and one wallet credit, including duplicate authenticated event/status query handling. Run read-only billing reconciliation with zero mismatches.
4. If creation outcome is unknown, preserve the existing Payment and investigate its reference. Do not create a replacement payment or force PAID. Refund/support actions retain the existing append-only controlled model.

After actual evidence passes, set XENDIT_SANDBOX_ACCEPTANCE_VERIFIED=1. This is sandbox acceptance only and creates no production charge.

## Other launch gates

Real SMTP requires controlled delivery, TLS/sender configuration, correct-domain verification/reset/invite links and retry recovery before PRODUCTION_MAIL_VERIFIED=1. Production storage requires private/CORS/signed PUT/GET/multipart/range/retention/backup checks before PRODUCTION_STORAGE_VERIFIED=1; >5 GiB handling remains provider-specific acceptance pending. Supervision, TLS/callbacks, stable worker/disk, operator access, deliberate production prices, clean reconciliation and a recent coordinated restore must also pass.

Run production preflight again after recording these checks. Its acceptance flags are explicit operator attestations; it never triggers paid AI, SMTP sends or a payment automatically. Keep the external paid-beta verdict BLOCKED until every required gate has real evidence.
