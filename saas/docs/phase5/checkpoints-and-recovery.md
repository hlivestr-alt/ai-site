# Checkpoints, fencing and retry

SOURCE_VERIFIED is durable source state/event. TRANSCRIPT_READY, PLAN_READY and OUTPUTS_READY are clipper_checkpoints pointing to independently READY JobArtifacts under the job input hash. RENDERING is progress; local render/analysis files and upload receipts additionally support same-attempt retry.

Download/network and transient analyzer/upload problems use bounded stage retries and at most three job attempts. Invalid source/plan/media, low disk and local processing/model problems require intervention. Expired CLIPPER leases use existing retry/backoff with new attempt/fence. Reconciliation never delegates authority to native state. A worker missing a local stage may restore matching sealed checkpoints through a current-lease signed GET, re-publish into its own attempt, and rebind plan transcript lineage. Cross-attempt outputs are never accepted directly by completion.

Temporary upload failure retries existing local output and allocation rather than re-transcribing/analyzing/rendering. A crash after transcript checkpoint reuses it when transcriber fingerprint matches; changed model/config deterministically re-transcribes. A durable plan skips analyzer calls. Rendered cloud checkpoints can be downloaded to avoid rerendering. No checkpoint is accepted from another workspace/job/input.

Late progress, source access, slot allocation, finalization and completion require current authenticated lease and are rejected 409 after expiry/fencing. Same successful completion is idempotent. Cancel prevents new cloud writes/render stages, stops owned child processes cooperatively, and uses the existing cancellation acknowledgment. Partial render files are not reused as finished outputs. Local files remain until safe terminal cleanup.

Known operational limit: provider calls whose response is lost before checkpoint may be replayed; bounded retries and stable local chunk keys reduce this, but external paid request exactly-once semantics are not promised.
