# Local transcription

Uses installed Faster-Whisper 1.2.1 with raw word timestamps, beam/best_of 5, VAD and 800 ms silence. Default model large-v3-turbo, CUDA float16; configure CLIPPER_WHISPER_MODEL, CLIPPER_WHISPER_DEVICE, CLIPPER_WHISPER_COMPUTE and CLIPPER_WHISPER_REVISION. local_files_only=True prevents unexpected network model downloads. Missing models/tooling are operational failures, not an implicit cloud fallback.

A per-job child Python process owns the model so lease loss/cancellation can terminate it safely. No raw source video is sent to OpenAI. WhisperX is installed but not used initially: the native alignment code introduces global patches and model orchestration. Raw Faster-Whisper words are the initial reliable default.

Private JSON transcript schemaVersion 3 includes sourceAssetId, sourceSha256, duration, language, segments {id,start,end,text,words}, flattened timed words and metadata {implementation,version,model,modelRevision,device,computeType,schemaVersion,alignment,fingerprint,processingSeconds,sourceDurationSeconds}. Local source/model paths are excluded from cloud metadata. Model path is rendered as basename in metadata.

Fingerprint includes source SHA-256, complete transcription configuration, package version and schema. Durable same-job transcript checkpoints and same-attempt files are reused only if fingerprint and source identity match. Different model configuration re-transcribes safely. No native shared store or SQLite registry is used, and there is no cross-customer transcript cache.
