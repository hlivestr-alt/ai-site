# Content model

Migration `0006_content_review.sql` leaves migrations 0001–0005 unchanged. It adds seven tables:

| Table | Purpose |
| --- | --- |
| `content_items` | Logical workspace media, type, title, frozen Product/source search fields, original job, current version, materialized review status/revision and archive time |
| `content_versions` | Immutable artifact/job identity, version number, checksum/size/geometry, Product/Rule versions, source and transcript/plan identities, bounded type metadata |
| `content_relations` | Immutable origin/source and variant edges |
| `review_decisions` | Append-only version-scoped decisions and idempotency/concurrency identity |
| `content_publications` | Durable one-per-job publication intent, retry state and completion |
| `content_reference_assets` | Exact AI Video reference AssetVersions, with ownership and retention foreign keys |
| `content_posters` | Independent bounded thumbnail work/status and private JPEG identity |

Types are `AI_VIDEO` and `CLIP`. Source videos remain SourceAssets. Status is `PENDING_REVIEW`, `APPROVED`, `REJECTED` or `ARCHIVED`. Every initial publication creates version 1 and starts Pending Review; Job success never approves Content.

Versions use normalized workspace/item/job/artifact/Product/Rule/source columns. Type-specific metadata is an object capped at 32 KiB. No transcript text is duplicated. Artifact SHA-256, byte size, MIME and geometry must exactly match an authoritative READY MP4 from the current SUCCEEDED attempt of a SUCCEEDED supported job. Clip versions additionally match source/transcript/plan/result clip identities.

Composite foreign keys bind versions to their workspace/item, job/artifact, Product/Version/Rule, SourceAsset and supporting artifacts. The current pointer references a version of the same item and workspace. A deferred constraint requires a current version when publication commits. A unique `(workspace_id, artifact_id)` prevents publishing the same artifact twice; `(content_item_id, version_number)` prevents duplicate version numbers.

Version, relation, reference and decision updates/deletes are blocked. Item deletion and origin identity changes are blocked. Published artifact identity/status changes are blocked and foreign keys retain referenced artifacts/assets/sources. Archive preserves all of these records.

Future trusted server code can append a version from a new successful job for the same logical type, Product and source. Switching the current pointer resets status to Pending Review and increments the review revision. Phase 6 exposes no customer regeneration/version-write API; independent job runs normally become independent items. The version-scope acceptance test exercises this future contract directly in the isolated database.
