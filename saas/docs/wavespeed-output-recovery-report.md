# Existing WaveSpeed output recovery — 2026-10-03

The existing paid Seedance prediction was recovered successfully through the normal MP4 ingestion and Content publication paths. Recovery reused the original Job, provider execution, attempt, and prediction. It made **zero WaveSpeed POSTs** and **zero additional paid generations**.

The output policy now also allows exactly `d2h7xmz5gqybh9.cloudfront.net`, alongside the two existing approved hosts. Arbitrary CloudFront tenants, HTTP, redirects, credentials, explicit ports, and fragments remain rejected.

## Read-only inspection before recovery

| Field | Observed value |
| --- | --- |
| Job ID | `e9b3788e-c498-4c1f-bd96-70f036431a40` |
| Workspace ID | `8cdbc816-4cb1-45d8-95f3-e910119cf23b` |
| Job status | `FAILED` |
| Job error_code | `OUTPUT_INVALID` |
| Job error_message_safe | `The provider output host was invalid.` |
| Provider execution ID | `e055a3f3-4f20-41a6-b46f-4531fe8d7ccd` |
| Provider state | `FAILED` |
| provider_error_code | `OUTPUT_INVALID` |
| safe_error | `The provider output host was invalid.` |
| external_task_id | `3aa327ae4d2a46ff899c9ac5c42986e2` |
| submit_count | `1` |
| poll_count | `44` |
| ingest_count | `0` |
| Attempt ID | `359c2557-22ee-4346-a419-4e88a884db77` |
| Attempt status / error_code | `FAILED` / `OUTPUT_INVALID` |
| Attempt error_message_safe | `The provider output host was invalid.` |

This inspection and the final checks used the isolated TEST database and private TEST bucket. The original job remained unchanged throughout deterministic verification.

## Final verified result

| Field | Verified value |
| --- | --- |
| Job / provider / attempt statuses | `SUCCEEDED` / `SUCCEEDED` / `SUCCEEDED` |
| Original prediction | `3aa327ae4d2a46ff899c9ac5c42986e2` |
| submit_count / poll_count / ingest_count | `1` / `44` / `1` |
| READY artifact ID | `95ae8e4a-3ce9-4e98-8bfd-07e3040ac50f` |
| Content ID | `2743536b-e84d-4b3d-afe3-b2ed1a590808` |
| Content publication status | `PUBLISHED` |
| ffprobe duration / dimensions | `4.04` seconds / `1280 × 720` |
| Private object size / MIME | `4,073,298` bytes / `video/mp4` |
| Private object SHA-256 | `6a82605c7e71079ffaf255c238647f5b341b0b9aa581674657a6208af229d9b4` |
| Unsigned download | `403` |
| Prediction GETs / video GETs during recovery | `2` / `1` |
| WaveSpeed POSTs / additional paid generations | `0` / `0` |

Private object HEAD metadata and a complete authenticated read confirmed byte count, MIME, MP4 signature, and SHA-256 against the READY artifact. Public access blocking remained enabled. Content references that same artifact and job. No provider output URL or API key appeared in the checked Job, execution, artifact, event, Content, or Content-version records.

The original IDs, immutable input digest/hash, idempotency identity, submission timestamps, attempt/execution counts, and submit_count were preserved. The existing submission guard and both credential files have unchanged SHA-256 hashes. One `PROVIDER_OUTPUT_RECOVERY_STARTED` event records the original host defect and ingestion-only recovery. The private durable smoke receipt now records SUCCEEDED and the existing artifact/Content identities.

The operator reported the original generation charge as **USD 1.296**. Recovery requested no price estimate or inference and incurred no new generation charge. Production acceptance flags were preserved.

## Commands completed

From `C:\Data\ai-site\saas`, deterministic checks passed before any live recovery:

```powershell
npm run test:unit
$env:SAAS_TEST_PORT='3211'
$env:SAAS_TEST_STORAGE_PORT='9011'
npx playwright test tests/integration/wavespeed.spec.ts tests/integration/wavespeed-recovery.spec.ts
npm run lint
npm run typecheck
$env:SAAS_NEXT_DIST_DIR='.next-tests'
npm run build
```

Results: 65 SaaS unit tests and 3 integration tests passed; lint, typecheck, and build passed. Integration tests used a temporary private SigV4 gateway at port 9011 and mocked provider responses. The tests verified refusals, ingestion-only dispatch even from RESERVED, preservation of persisted backoff, recovery after six failed downloads with the same audited prediction, private output checks, and idempotent Content publication. The temporary gateway was removed and the TEST bucket's original CORS restored; the existing server on port 3200 was preserved.

From `C:\Data\ai-site\worker-agent`, all 26 worker unit tests passed:

```powershell
python -m unittest discover -s tests -p 'test_*.py'
```

After those checks, the live recovery command completed successfully from `C:\Data\ai-site\saas`:

```powershell
npm run wavespeed:video-smoke -- recover-output --acknowledge-existing-prediction
```

Recovery is complete. No further operator command is required. Repeating that recovery command is idempotent against the same durable receipt and retains the submission guard.
