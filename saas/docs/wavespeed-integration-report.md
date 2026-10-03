# WaveSpeed integration acceptance report

Date: 2026-10-03. Implementation and deterministic local verification are complete. Live acceptance is blocked by the unavailable private WaveSpeed credential. Production acceptance is **NOT VERIFIED**.

1. **Files changed**

   New provider, migration, preflight, smoke-test, and test files:
   - `saas/src/lib/video-providers/wavespeed.ts`
   - `saas/src/lib/wavespeed-config.ts`
   - `saas/src/lib/wavespeed-preflight.ts`
   - `saas/migrations/0010_wavespeed_providers.sql`
   - `saas/scripts/wavespeed-preflight.ts`
   - `saas/scripts/wavespeed-video-smoke.ts`
   - `saas/tests/unit/wavespeed.test.ts`
   - `saas/tests/unit/wavespeed-preflight.test.ts`
   - `saas/tests/integration/wavespeed.spec.ts`
   - `saas/tests/integration/wavespeed-clipper.spec.ts`
   - `saas/tests/invoke-wavespeed.ts`
   - `saas/tests/invoke-wavespeed-clipper.ts`
   - `worker-agent/clipper_pipeline/wavespeed_analyzer.py`
   - `worker-agent/tests/test_wavespeed.py`
   - `worker-agent/wavespeed_smoke.py`
   - `saas/docs/wavespeed-providers.md`
   - `saas/docs/wavespeed-integration-report.md`

   Updated provider selection, frozen jobs, worker routing, ingest, and operations:
   - `saas/src/lib/video-providers/index.ts`
   - `saas/src/lib/video-providers/types.ts`
   - `saas/src/lib/job-core.ts`
   - `saas/src/lib/provider-core.ts`
   - `saas/src/lib/provider-ingest.ts`
   - `saas/src/lib/operational-config.ts`
   - `saas/src/lib/clipper-operation.ts`
   - `saas/src/lib/worker-core.ts`
   - `saas/src/app/clipper/page.tsx`
   - `saas/scripts/operations.ts`
   - `worker-agent/clipper_pipeline/analyzer.py`
   - `worker-agent/clipper_pipeline/pipeline.py`
   - `worker-agent/clipper_executor.py`
   - `worker-agent/worker_agent.py`

   Updated configuration and documentation:
   - `saas/.env.example`
   - `saas/deploy/production.env.example`
   - `worker-agent/.env.example`
   - `saas/README.md`
   - `worker-agent/README.md`
   - `saas/docs/phase4/video-provider-interface.md`
   - `saas/docs/phase5/transcript-analyzer.md`
   - `saas/docs/phase9/external-acceptance.md`
   - `saas/docs/phase9/health-readiness.md`
   - `saas/docs/phase9/production-config.md`
   - `saas/package.json`

   Updated test isolation and existing test URL selection to preserve the already running remote-test app:
   - `.gitignore`
   - `saas/eslint.config.mjs`
   - `saas/next.config.ts`
   - `saas/tsconfig.json`
   - `saas/playwright.config.ts`
   - `saas/docker/storage-gateway-config.mjs`
   - `saas/scripts/storage-init.mjs`
   - `saas/tests/schema-bootstrap.mjs`
   - `saas/tests/clipper-helpers.ts`
   - `saas/tests/browser/ai-video-journey.spec.ts`
   - `saas/tests/browser/billing-journey.spec.ts`
   - `saas/tests/browser/jobs-journey.spec.ts`
   - `saas/tests/browser/journey.spec.ts`
   - `saas/tests/browser/products-journey.spec.ts`
   - `saas/tests/integration/ai-video.spec.ts`
   - `saas/tests/integration/clipper.spec.ts`
   - `saas/tests/integration/content.spec.ts`
   - `saas/tests/integration/foundation.spec.ts`
   - `saas/tests/integration/jobs.spec.ts`
   - `saas/tests/integration/products.spec.ts`

2. **WaveSpeed video design**

   Additional WAVESPEED implementation of VideoProvider, selected for new jobs by VIDEO_PROVIDER. Separate QUALITY policies preserve BytePlus and frozen job routing. The official six-field request uses 4–30 seconds, 720p, three ratios, quantity one, up to four selected private Product images, and generate_audio=false. Customer prompt and saved accuracy instructions are preserved.

   One submission POST returns data.id; all ambiguous acceptance outcomes become SUBMISSION_UNKNOWN / RECONCILING. There is no automatic replay or invented task lookup. Known IDs use bounded GET backoff. Known terminal states are mapped; unknown and malformed states fail safely.

   Product references require verified external HTTPS fetch access, public DNS, freshly signed object-specific URLs with 3600–7200 seconds TTL, and a bounded GET matching frozen MIME/bytes/SHA-256. References fail before submission when unavailable. Signed URLs stay in request memory. Buckets stay private.

   Output permits two exact officially evidenced CDN hosts, HTTPS, no redirects or credentials, bounded time/size, MP4 signature and successful ffprobe. Existing private READY artifacts and immutable Content remain the publication path. CDN addresses and raw responses are not retained in customer assets.

3. **WaveSpeed Clipper analyzer design**

   Only TranscriptAnalyzer is added. Local Faster-Whisper, deterministic selection, and local FFmpeg remain the pipeline. WaveSpeed receives bounded transcript text and supplied textual Product context.

   Uses Chat Completions JSON mode; current WaveSpeed documentation verifies JSON mode, while the complete strict Responses text.format contract for this model remains unverified. Local validation checks the exact candidate schema, maximum 20, finite timestamps/scores, source/chunk bounds, requested duration, text/tag bounds, refusals/truncation, model identity, response size, duplicate keys, and secret echoes. Transcript text remains untrusted. There is no model or protocol fallback.

   New jobs freeze analyzerModel. Health and claim routing require a configured matching WaveSpeed worker/model; legacy direct OpenAI worker health remains compatible. Private normalized usage keeps input/output tokens, request count, and model ID. Customer Token pricing is unchanged.

4. **Exact environment variable names**

   Video:
   `VIDEO_PROVIDER`, `WAVESPEED_API_KEY`, `WAVESPEED_VIDEO_BASE_URL`, `WAVESPEED_SEEDANCE_MODEL`.

   Analyzer:
   `CLIP_ANALYZER_PROVIDER`, `WAVESPEED_API_KEY`, `WAVESPEED_LLM_BASE_URL`, `WAVESPEED_CLIP_MODEL`.

   Private references and worker attestation:
   `WAVESPEED_REFERENCE_FETCH_VERIFIED`, `WAVESPEED_REFERENCE_URL_TTL_SECONDS`, existing `OBJECT_STORAGE_PUBLIC_ENDPOINT`, `CLIP_ANALYZER_WORKER_CREDENTIAL_CONFIGURED`, `PRIVATE_WORKER_ENV_FILE`.

   Production acceptance:
   `WAVESPEED_VIDEO_ACCEPTANCE_VERIFIED`, `WAVESPEED_CLIP_ACCEPTANCE_VERIFIED` (keep both zero until full acceptance).

   Existing `OPENAI_WORKER_CREDENTIAL_CONFIGURED`, `CLIPPER_ANALYZER_CONFIGURED`, `OPENAI_*`, and `BYTEPLUS_*` remain compatible and independent. Existing `FFPROBE_PATH` and `MAX_GENERATED_VIDEO_BYTES` govern output inspection/limits.

   Test isolation:
   `SAAS_TEST_PORT`, `SAAS_TEST_STORAGE_PORT`, `SAAS_NEXT_DIST_DIR`, `TEST_DATABASE_URL`, `TEST_OBJECT_STORAGE_BUCKET`.

5. **Selected model IDs**

   Video: `bytedance/seedance-2.5/text-to-video`.

   Initial analyzer target: `openai/gpt-5.6-luna`. WAVESPEED_CLIP_MODEL supports other exact vendor/model IDs after a fresh availability/support check; no architectural change or silent substitution.

   These are documented/configured targets. Account-specific authenticated availability has **not** been verified.

6. **Preflight results**

   `npm run wavespeed:preflight`: ready=false; MISSING_WAVESPEED_API_KEY. Both exact model catalogs and the authenticated input-specific price are NOT_CHECKED. No network or inference request occurred.

   `npm run external:preflight`: selected video/analyzer and both WaveSpeed configuration booleans are false. Existing BytePlus, OpenAI, Xendit, SMTP, and production-storage booleans are also false in this local environment. This is a configuration result, not an external-service authentication result.

   The credential was absent from the process environment and the existing project/worker private env files checked. No private provider credential or runtime selection was added. Migration 0010 passed on the isolated TEST database and a fresh bootstrap database; the main configured database still reports 0010 pending.

7. **LLM live smoke result**

   `python wavespeed_smoke.py --env .env`: BLOCKED / ANALYZER_NOT_CONFIGURED. Zero live LLM POSTs. Valid candidate JSON and normalized usage passed deterministic mocked tests; live inference and usage remain unverified.

8. **Paid Seedance test executed**

   **No.** Zero inference submissions and zero reference generations. The guarded smoke command is implemented and tested through the underlying durable provider flow, but has not been prepared/submitted against WaveSpeed.

   Its fixed request is four seconds, 720p, 16:9, quantity one, no references, and no audio. A persistent exclusive guard, fixed idempotency identity, diagnostic billing, and maxAttempts=1 prevent automatic additional generations.

9. **Provider cost**

   Incurred by this task: **US$0**, because no live inference was performed. Actual account balance and charges are unknown.

   Published 720p reference rate checked on 2026-10-03: US$0.36/second, approximately **US$1.44 for four seconds before discounts**. This is not an authenticated account quote. The non-inference price API must return a fresh exact-input estimate before submission; final provider task billing takes precedence. [Official model pricing](https://wavespeed.ai/models/bytedance/seedance-2.5/text-to-video), [official price API](https://wavespeed.ai/docs/pricing-api).

10. **Tests and build**

   | Check | Result |
   | --- | --- |
   | SaaS unit tests | 48 passed |
   | Full browser/integration command | 38 passed |
   | Added Clipper provider/model routing integration, subsequent targeted run | 1 passed |
   | Windows worker unit tests | 19 passed |
   | Fresh database bootstrap through migration 0010 | Passed |
   | ESLint | Passed |
   | TypeScript check | Passed |
   | Next production build | Passed |
   | Git whitespace check | Passed |
   | WaveSpeed credential/provider references in browser JS chunks | 0 |

   The 38-test full run includes the new seven-scenario video integration. It checks ambiguous submission without replay, polling 429 recovery, terminal failure, invalid CDN, invalid MP4, unavailable references without POST, and successful private artifact/Content publication. The subsequent routing test checks legacy/wrong/unconfigured workers and exact frozen model compatibility.

   Tests used loopback app port 3211, a dedicated temporary gateway on 9011, TEST_DATABASE_URL, TEST_OBJECT_STORAGE_BUCKET, and .next-tests. The existing port-3200 app and main private bucket were not reconfigured. The dedicated gateway was stopped and its ignored credential env file removed; the existing app login returned HTTP 200 afterward. Build outputs and local fixture data are ignored. No .env.local, secrets, pricing changes, or native/internal app changes are part of this patch.

11. **Remaining blockers**

   - Private WAVESPEED_API_KEY location is needed to authenticate and execute the requested live checks.
   - Main database migration 0010 and coordinated server/worker provider configuration are pending activation.
   - Exact account model availability and selected-model JSON-mode behavior need live verification.
   - Account-specific four-second price and first video result are unverified.
   - The remote private storage hostname has not been proven fetchable from WaveSpeed; reference verification remains disabled. A reference generation requires text-only success, verified external fetch access, and separate authorization because the current task stops at one billable Seedance generation.
   - Production infrastructure, supervision, backup/restore, worker hardware, provider acceptance, and the rest of Phase 9 acceptance remain operator responsibilities. Production acceptance is NOT VERIFIED.

12. **Exact next operator step**

   Provide the **path only** to the protected env file already containing WAVESPEED_API_KEY, or set it through the private process environment. Do not paste the key into chat. Configure the exact values from wavespeed-providers.md on the SaaS and private worker; keep reference and production-acceptance flags zero.

   The next non-video checks are:

   ```powershell
   cd C:\Data\ai-site\saas
   npm run db:migrate
   npm run external:preflight
   npm run wavespeed:preflight
   cd C:\Data\ai-site\worker-agent
   python wavespeed_smoke.py --env .env
   ```

   After these checks pass, an existing CANCELLED fake-video template verified in the isolated TEST database is `2338aefc-4dc3-4504-bc06-1d9185085533`. It may be used for the fixed connectivity request:

   ```powershell
   cd C:\Data\ai-site\saas
   npm run wavespeed:video-smoke -- prepare 2338aefc-4dc3-4504-bc06-1d9185085533
   # Inspect the sanitized exact-input price before executing the one authorized video.
   npm run wavespeed:video-smoke -- submit --acknowledge-cost
   npm run wavespeed:video-smoke -- poll
   ```

   If fixture data has been reset, select another CANCELLED fake-video template from the isolated TEST database first. Keep the receipt and submission guard after any failure. Resume polling/reconcile the existing prediction; do not resubmit. Stop after the first billable Seedance generation.
