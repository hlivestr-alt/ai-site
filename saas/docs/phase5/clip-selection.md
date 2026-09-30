# Chunking, candidate validation and global selection

Chunks carry absolute source timestamps, up to 16000 text characters and nominal 300 seconds, with 90-second overlapping speech windows. A single oversized segment fails safely rather than truncating speech silently; a single long segment can exceed the nominal time window. At most 256 chunks and 20 candidates per chunk bound work.

Candidate exact fields: start/end/score/hook/reason/tags. All times/scores must be finite numbers (booleans rejected); start ≥0; end > start and ≤source duration; span within customer limits; score 0–100; hook 1–160, reason 1–500 characters; ≤8 tags of 1–40 characters. Chunk candidates must fall inside that chunk. Invalid entries are rejected, and a nonempty response with no valid entries fails instead of rendering unsafe spans.

Words permit ≤350 ms speech-boundary snapping only when full duration/bounds still validate. Candidates are globally sorted, deduplicated when overlap/min(span) >0.5, then chosen with score, bounded goal-token relevance and repeated-tag diversity penalties. Request count is an upper bound, never a mandate to invent spans.

Plan schemaVersion 1 carries source ID/SHA, immutable input hash, transcript fingerprint/artifact ID, analyzer/render policies, provider/model identifiers, bounded usage, candidate count, requested count and selected clips. Server checks lineage, policies, current-attempt transcript and candidate spans before READY; completion must match the sealed plan.
