# Worker media and output staging

The worker receives frozen AssetVersion IDs and metadata, never private object keys or storage credentials. For a current lease, `POST /api/worker/jobs/:id/assets/download` accepts an AssetVersion ID. The server checks that it belongs to the Job snapshot and still maps to the expected READY version/key, confirms the object exists through `ObjectStorage`, and issues a short-lived signed GET. Other Job/Workspace IDs and arbitrary `storageKey` input are rejected.

For output, `POST /api/worker/jobs/:id/outputs` accepts an approved slot name, MIME type, byte size, and optional SHA-256. The server generates the workspace/Job/attempt/artifact path and a short-lived signed PUT. The worker cannot choose the key. Phase 3 slots allow JSON, PNG, or MP4 up to 20 MiB for contract testing; larger real outputs need a later policy. Completion references only artifact IDs created for that exact current attempt. The server checks the object MIME type, size, and SHA-256 before marking staging artifacts READY. These rows do not publish Content Library items.

Signed URLs are short lived and must not be written to logs or stored in Job snapshots. The local S3-compatible bucket remains private. The worker agent fixture does not need to download or upload media during its normal run; integration tests exercise the contract.
