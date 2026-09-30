# Private Windows worker

worker-agent/clipper_pipeline is worker-owned. ClipperPipeline.run(source, transcriptOptions, analyzerOptions, renderOptions, callbacks) receives immutable input and scoped callbacks, not sessions/database/storage credentials. Agent dispatches SYSTEM_TEST to its retained fixture executor, CLIPPER to ClipperExecutor; no AI_VIDEO executor exists.

Provision CLIPPER_V1 explicitly for production. A fixture worker uses CLIPPER_TEST_V1; worker rejects fake analysis for a production capability. The SaaS capability match and active-lease query cap Clipper at one active job per worker, even on a generic 2-slot worker. Two provisioned workers may process different jobs concurrently.

Each attempt uses data/jobs/<job UUID>/<attempt UUID>/{source,transcript,analysis,render,outputs,logs}. Paths derive only from validated UUIDs. Source access, verify, checkpoint lookup, artifact allocation/finalization, progress and completion use worker bearer + current job/attempt/lease/fencing token. Keys are generated server-side. safeWorkerInput omits private keys and Product binaries.

LeaseGuard renews independently every ≤10 seconds while stages run. It tracks the returned expiry, pauses unsafe mutations after fencing or expiry, propagates cancellation, and stops only its own child process. Progress reports stage milestones, monotonic within each attempt. Source download/hash, analyzer retries, transfer loops and child wait loops check cancellation. Ctrl+C drains running jobs and stops claims.

Heartbeat persists bounded booleans for transcriber/FFmpeg/GPU availability, free working disk bytes, advertised slots, and pipeline version; customers do not receive paths or worker diagnostics. Disk precheck reserves twice source bytes + count × max output bytes + 1 GiB, with WORKER_MAX_LOCAL_JOB_BYTES default 40 GiB. Low space fails WORKER_DISK_SPACE_LOW before download.

Successful completion cleans large local stage directories only after cloud validation and terminal acknowledgment. Hourly cleanup of old attempt directories (default 24 hours, minimum one hour) asks authenticated cleanup-state: only terminal SUCCEEDED/FAILED/CANCELLED jobs may be removed. Interrupted/requeued jobs retain checkpoints until their job is terminal. WORKER_TERMINAL_RETENTION_SECONDS configures retention.
