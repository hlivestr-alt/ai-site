# Local rendering and private outputs

Extracted native cut/probe and relative caption concepts, with isolated paths instead of full ffmpeg_editor import. Uses local FFmpeg: source seek, exact duration, center-fill scale/crop 720×1280, 30 fps, H.264 libx264 veryfast CRF23, yuv420p, AAC 128k, +faststart. Two CPU encoder threads keep initial capacity modest; native NVENC global semaphore is not used.

Captions On generates attempt-local ASS using real word/segment timings clipped to the selected interval, grouped up to six words/38 characters. ASS control characters are removed from customer speech. Caption text is never invented; generic Arial with white text/outline is used. Off omits the subtitle filter.

Every output is ffprobed locally for H.264, geometry, duration and size, then SHA-256 hashed. MAX_CLIPPER_OUTPUT_BYTES defaults to 256 MiB, hard cap 512 MiB per clip. FFmpeg gets a size cap and a 600-second timeout; a truncated/incorrect-duration result fails verification.

Approved slots are transcript (JSON ≤64 MiB), clip-plan (JSON ≤20 MiB), clip_001…clip_010 (bounded MP4). Server copies staging to an inaccessible-to-PUT sealed key, streams to a bounded local temporary file for SHA/container/probe checks, verifies lease again after I/O, then marks READY and records checkpoints. Long transfers do not hold the lease row lock. Only current-attempt READY artifacts and a plan-matching safe manifest may complete a job.

Private download API authorizes workspace + job + artifact and requires successful job/result membership. URLs last five minutes and are refreshed by preview UI. Result metadata contains artifact IDs, times/duration, score/hook/reason/tags, geometry/checksum and lineage/version fields; no local path, storage secret or persisted signed URL.

Preview URLs use inline disposition; download links request a separately signed attachment disposition so cross-origin Chrome downloads work. Successful completion clears prior retry errors, and completed pages show the ready state rather than an obsolete processing warning.
