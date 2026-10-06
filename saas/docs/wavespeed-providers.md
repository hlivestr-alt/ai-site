# WaveSpeed providers

WaveSpeed is an additional video provider and transcript analyzer. BytePlus, direct OpenAI Responses, and the explicit local fake providers remain supported. Provider billing does not change the Phase 7 customer Token catalog, reservations, capture, or release rules.

## Server and worker configuration

Store credentials only in a protected process environment or ignored private env file. Never use NEXT_PUBLIC variables, customer settings, database records, output artifacts, or command-line arguments for keys.

SaaS video environment:

```dotenv
VIDEO_PROVIDER=wavespeed
WAVESPEED_API_KEY=
WAVESPEED_VIDEO_BASE_URL=https://api.wavespeed.ai
WAVESPEED_SEEDANCE_MODEL=bytedance/seedance-2.5/text-to-video
WAVESPEED_REFERENCE_FETCH_VERIFIED=0
WAVESPEED_REFERENCE_URL_TTL_SECONDS=3600
```

Private Windows worker environment:

```dotenv
CLIP_ANALYZER_PROVIDER=wavespeed
WAVESPEED_API_KEY=
WAVESPEED_LLM_BASE_URL=https://llm.wavespeed.ai/v1
WAVESPEED_CLIP_MODEL=openai/gpt-5.6-luna
```

The SaaS must also select CLIP_ANALYZER_PROVIDER=wavespeed and the same WAVESPEED_CLIP_MODEL. If the shared WaveSpeed key is absent from the web process, CLIP_ANALYZER_WORKER_CREDENTIAL_CONFIGURED=1 attests the private worker credential. A colocated operator can set PRIVATE_WORKER_ENV_FILE to let external-preflight inspect that file without displaying its values. The legacy OPENAI_WORKER_CREDENTIAL_CONFIGURED and CLIPPER_ANALYZER_CONFIGURED flags remain compatible with direct OpenAI. New WaveSpeed jobs freeze analyzerModel; workers reject a configured or returned model mismatch. Worker health and claim routing match the frozen provider/model, including after recovery.

Apply migration 0010 before enabling WaveSpeed:

```powershell
cd C:\Data\ai-site\saas
npm run db:migrate
```

It adds WAVESPEED to provider constraints and a separate QUALITY policy, with 4–30 seconds, 720p, 9:16/16:9/1:1, quantity one, and **four** Product references. The existing BytePlus policy stays enabled independently; VIDEO_PROVIDER selects the policy for new jobs. Existing jobs execute their frozen provider and policy. Video model changes require a deliberately reviewed adapter/policy, and never silently alter a frozen execution. LLM model changes only need WAVESPEED_CLIP_MODEL, matching SaaS/worker configuration, and a fresh model/support preflight.

## Video contract and submission safety

The adapter submits once to POST /api/v3/bytedance/seedance-2.5/text-to-video with prompt, aspect_ratio, resolution, duration, reference_images, and generate_audio=false. It preserves the customer prompt and saved accuracy instructions and prohibits invented Product claims. It parses data.id (and the documented unwrapped form), then polls GET /api/v3/predictions/{id}/result. It does not use BytePlus response fields or keys.

| WaveSpeed state | Normalized state |
| --- | --- |
| created, queued, pending | queued |
| processing, running | running |
| completed with one allowed output URL | succeeded |
| failed, timeout, deleted | failed |
| cancelled, canceled | cancelled |
| Unknown/malformed | Safe status error; never success |

A network failure, lost body, timeout, 408, redirect, 5xx, invalid envelope, or missing/invalid ID on submit becomes SUBMISSION_UNKNOWN and the Job becomes RECONCILING. The adapter has no POST retry loop and no documented submission-token recovery endpoint. The existing runner only retries a definite HTTP 429 rejection within its bounded job attempts; the paid smoke uses maxAttempts=1, so even that is not replayed. A known prediction ID permits GET retries with the existing bounded backoff (up to 80 seconds for transient polling errors). Unknown submissions require operator reconciliation with WaveSpeed's task history; never resubmit to discover whether a previous request ran.

WaveSpeed's documented deletion API deletes finished predictions. It is not used as cancellation. A cancellation request for an already submitted WaveSpeed prediction is recorded locally while the provider result remains subject to normal completion/billing rules.

## Private Product references

No bucket ACL or policy is made public. Only selected immutable asset versions receive short-lived SigV4 GET URLs, kept in request memory. They are never copied into job snapshots, artifacts, event logs, or customer DTOs.

Reference submission requires all of:

- WAVESPEED_REFERENCE_FETCH_VERIFIED=1, set only after independently verifying fetch access from WaveSpeed or a suitable external vantage point without a browser login, Cloudflare challenge, Access cookie, or client certificate. A successful local GET alone does not prove WaveSpeed access.
- An exact external HTTPS storage origin, no IP literal/loopback/internal host, a public DNS resolution, and no redirect.
- A newly signed URL with the expected origin, SigV4 signature, and 3600–7200 seconds TTL, with at least TTL minus 60 seconds remaining at verification. The default is one hour; queueing must fit this window.
- A bounded unauthenticated GET of the signed URL that matches the selected asset's MIME, byte count, and frozen SHA-256 before the generation POST.

The existing OBJECT_STORAGE_PUBLIC_ENDPOINT=https://storage-test.proyaofficial.com may be used only when these conditions are verified. The SaaS keeps its private internal storage transport. A localhost-only or unverified remote-test LocalStack deployment fails REFERENCE_UNAVAILABLE before submitting; references are never silently discarded. Signed URLs authorize selected objects only and do not enable bucket listing.

## Output ingest

Completed output is retrieved on the server with no provider key, HTTPS only, no redirects, a 60-second timeout, and MAX_GENERATED_VIDEO_BYTES (default 256 MiB, existing bounded maximum 512 MiB). Both declared and streamed byte sizes are checked. MIME, MP4 ftyp, byte count/checksum, and a successful ffprobe video/duration check precede publication. FFPROBE_PATH is supported.

The host policy allows exactly cdn.wavespeed.ai, d2p7pge43lyniu.cloudfront.net, and d2h7xmz5gqybh9.cloudfront.net. The first two appear in the official WaveSpeedAI/wavespeed-comfyui README and checked-in example. The third was verified in the authenticated completed Seedance prediction 3aa327ae4d2a46ff899c9ac5c42986e2 on 2026-10-03. Arbitrary *.cloudfront.net, arbitrary *.wavespeed.ai, HTTP, credentials, explicit ports (including :443), fragments, and redirects are rejected. A newly observed CDN requires verified provider evidence and a reviewed policy update; do not broaden the policy merely to make a download pass.

The downloaded file uses the existing staged, checksummed READY artifact path and immutable Content publication. The provider CDN URL is neither stored as the permanent customer asset nor included in customer responses.

## Transcript analysis

The pipeline stays source video → local Faster-Whisper → transcript → analyzer → deterministic selection → local FFmpeg. WaveSpeed receives only bounded timestamped text, goals, and supplied textual Product facts.

The implementation uses POST /v1/chat/completions with response_format={type:"json_object"}, a system policy plus the candidate JSON schema, and a separate untrusted user message. WaveSpeed documents JSON mode. Its current model page also advertises Responses/structured outputs, but does not establish the full strict Responses text.format contract for this model, so no assumptions about direct OpenAI Responses fields are made. There is no fallback to a different model, Responses endpoint, or unstructured text on rejection.

Local validation rejects malformed/duplicate-key/non-finite JSON, extra fields, more than 20 candidates, timestamps outside the source/chunk, clips outside requested durations, scores outside 0–100, empty/oversized hook or reason, and oversized/invalid tags. Incomplete results, refusals/tool calls, unexpected model IDs, secret echoes, oversized bodies, and invalid usage fail safely before caching/rendering. Per-chunk fingerprints include the actual selected model. The existing pipeline retries transient LLM failures at most three times with bounded backoff and resumes successful chunk checkpoints; the live smoke sends exactly one analyzer POST.

Only normalized input tokens, output tokens, request count, and model ID enter the private analysis/checkpoint lineage. Provider errors expose fixed codes only, and raw envelopes/headers are not retained. Provider usage does not set the customer's Token price.

## Cheap live checks and the one-generation cap

```powershell
cd C:\Data\ai-site\saas
npm run external:preflight
npm run wavespeed:preflight
cd C:\Data\ai-site\worker-agent
python wavespeed_smoke.py --env .env
```

wavespeed:preflight uses authenticated GET /api/v3/balance, GET /api/v3/models, GET https://llm.wavespeed.ai/v1/models, and the non-inference POST /api/v3/model/price. It requires the exact configured model IDs and estimates the exact 4-second/720p/no-reference/no-audio input. It prints a sanitized status/price receipt, never credentials or raw responses. The worker smoke checks the exact authenticated model catalog and sends one small controlled transcript, validates candidates, and requires captured nonzero usage. No retry or model substitution occurs in either smoke.

The LLM availability check uses the authenticated list when its data is a usable model array. WaveSpeed can return HTTP 200 with data:null even when the account has model access. In that case, both the SaaS and worker perform an authenticated GET /v1/models/{configured-model-id}; only HTTP 200 with the exact id and object="model" when that field is present verifies availability. Authentication failures, missing models, malformed responses, and redirects never verify access. No unauthenticated catalog or inference request is used. For a worker availability check without transcript inference, run `python wavespeed_smoke.py --env .env --check-model-only` from the worker-agent directory.

For the paid connectivity test, first choose a CANCELLED fake-video template job from the **isolated TEST database**, after migration 0010. The template supplies valid immutable lineage, not a customer charge. Then:

```powershell
cd C:\Data\ai-site\saas
npm run wavespeed:video-smoke -- prepare TEMPLATE_JOB_ID
# Inspect the sanitized price/payload. Submit only with operator authorization.
npm run wavespeed:video-smoke -- submit --acknowledge-cost
npm run wavespeed:video-smoke -- poll
```

The script uses TEST_DATABASE_URL and TEST_OBJECT_STORAGE_BUCKET, rejects production/shared targets, and records a private receipt in ignored data/wavespeed. The prepare command makes no inference request. Submit rechecks account/model/price, requires a fresh receipt and explicit cost acknowledgement, creates one diagnostic job with maxAttempts=1, and retains an exclusive submission guard before any possible generation POST. It never automatically creates a second generation. Poll resumes only the existing prediction and artifact ingestion, honors persisted backoff, and never submits. Do not delete the guard or change idempotency keys to recover an ambiguous request. All customer Token pricing remains unchanged; actual provider billing must be checked separately in WaveSpeed's billing records.

For an already completed diagnostic smoke that failed specifically with OUTPUT_INVALID / "The provider output host was invalid.", recover the existing output from the saas directory:

```powershell
npm run wavespeed:video-smoke -- recover-output --acknowledge-existing-prediction
```

Recovery requires the original private receipt and retained submission guard. It validates the fixed diagnostic input/idempotency identity, one original execution/attempt, submit_count=1, and the exact persisted prediction. An authenticated GET must confirm the matching prediction is completed with one approved output before a transaction reopens only those existing records for ingestion and appends an audit event. The command has an ingestion-only dispatch entry point and a GET-only network guard; it cannot submit a video, create replacement execution records, or call price/inference endpoints. The normal bounded MP4 download, signature checks, ffprobe, private storage verification, READY artifact sealing, and Content publication then run.

Repeated recovery after success returns the existing artifact/Content. Transient failures retain the prediction and retry backoff; the same command or `npm run wavespeed:video-smoke -- poll` can resume. A retry after exhausted ingestion is allowed only when an audit event proves this exact execution was first recovered from the host defect. It preserves counters and the submission guard and rechecks the same completed prediction. Unrelated provider failures, normal customer jobs, changed model/payload, and a mismatched prediction remain ineligible.

Published reference pricing on 2026-10-03 is $0.36/second at 720p without reference video: a four-second clip is approximately **US$1.44 before account discounts**. The authenticated input-specific estimate and final task charge take precedence.

**Stop after one billable Seedance generation.** A subsequent Product-reference generation requires separately authorized work after text-only success and verified fetch access. A local reference GET is a useful transport check but is not a paid reference-generation acceptance result.

Keep WAVESPEED_VIDEO_ACCEPTANCE_VERIFIED=0 and WAVESPEED_CLIP_ACCEPTANCE_VERIFIED=0 until the complete production acceptance procedure passes. One mocked or cheap live smoke never verifies production readiness. Production preflight evaluates only the selected providers' credentials and acceptance flags, while keeping the direct-provider flags compatible.

## Verification

```powershell
cd C:\Data\ai-site\saas
npm run test:unit
npm run test:integration
npm run test:browser
npm run lint
npm run typecheck
npm run build
cd C:\Data\ai-site\worker-agent
python -m unittest discover -s tests -p 'test_*.py' -v
```

The browser command includes the integration suite. For an already running app, SAAS_TEST_PORT can select a different loopback app port, with a separate .next-tests build directory. SAAS_TEST_STORAGE_PORT selects a separately provisioned loopback SigV4 test gateway; alternate gateway ports require APP_ENV=test and the explicit test-port flag. Test setup initializes only TEST_OBJECT_STORAGE_BUCKET. The running remote-test server and its private bucket are not reconfigured.

Official references checked on 2026-10-03: [Seedance 2.5 API](https://wavespeed.ai/docs/docs-api/bytedance/bytedance-seedance-2.5-text-to-video), [model and reference pricing](https://wavespeed.ai/models/bytedance/seedance-2.5/text-to-video), [LLM protocol](https://wavespeed.ai/docs/llm-service-overview), [JSON mode](https://wavespeed.ai/blog/posts/wavespeed-llm-api-quick-start/), [configured LLM model](https://wavespeed.ai/llm/openai/gpt-5.6-luna), [prediction results](https://wavespeed.ai/docs/get-result), [deletion semantics](https://wavespeed.ai/docs/delete-task), [account check](https://wavespeed.ai/docs/check-balance), [price API](https://wavespeed.ai/docs/pricing-api), [official CDN example](https://github.com/WaveSpeedAI/wavespeed-comfyui/blob/master/examples/case5-video-to-video/case5-v2v.json).
