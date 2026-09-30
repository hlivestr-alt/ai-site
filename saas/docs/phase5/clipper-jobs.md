# CLIPPER job contract

schemaVersion 1 and kind CLIPPER discriminate this input from SYSTEM_TEST and AI_VIDEO. Source freezes origin SOURCE_ASSET, sourceAssetId, server-only storageKey, opaque storageIdentity, byteSize, MIME and filename. Customer settings: language auto or en/id/zh/es/fr/de/ja/ko/pt/ar/hi; goal 1–1000 characters; target 1–10 clips; minimum/maximum integral duration 10–90 seconds; minimum ≤ maximum; 9:16; captions boolean.

Optional active Product uses the existing immutable version/rule snapshot. Clipper freezes text and version identity, with assets empty: unrelated Product binary objects never enter analyzer input. No Product is required for generic clipping.

Server freezes analyzerProvider openai, clip-selection-v1 analyzer policy and vertical-h264-v1 render policy. Only explicitly enabled local tests use fake and CLIPPER_TEST_V1. Production capability is CLIPPER_V1. Idempotency is existing UNIQUE(workspace,type,key) plus normalized client_request_hash. Concurrent same request returns one job; changed request returns 409. Frozen source/settings remain reusable after Product changes. Retry creates a new attempt of the same job, not a duplicate job.

GET/POST /api/workspaces/:workspace/clipper provides history/submission. GET /clipper/:job provides sanitized detail. Customer cancel uses the existing future:edit permission and jobs/:job/cancel route. Viewer may read authorized history/results, cannot upload/submit/cancel. Sources may be reused for new goals without reupload.

Future origin READY_JOB_ARTIFACT must be a new authorized union branch freezing the workspace/artifact identity; this phase intentionally does not wire AI Video chaining.
