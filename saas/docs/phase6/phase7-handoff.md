# Phase 7 handoff: tokens, pricing, wallet ledger and payments

Phase 6 stops at durable Content, lineage, review and private media. No billing/payment table, token balance, reservation/capture/release/refund flow, workflow executor or distribution/outreach is added.

Stable billing attachment points already exist: ContentVersion → successful job ID/type/input hash → immutable attempt and sealed artifact/result → provider execution or private worker attempt. AI Video provider execution identity, submission count and result policy remain in the Phase 4 contract. Clipper job/attempt/result and bounded analyzer/render/pipeline lineage remain in Phase 5/6. A future ledger should attach reservation/capture/release/refund to these stable Jobs/executions rather than rewriting Content identity or treating review approval as a generation charge.

Publication may retry after success without another execution; billing must not charge publication retries, poster extraction retries, review requests or variant-registration edges as new video generation. Use independent ledger idempotency identities and transaction boundaries when Phase 7 is authorized. No ledger hook is executed now. ContentVersions have immutable Job links suitable for future joins.

Future Workflow/Distribution should call the server `isContentApproved(workspaceId, contentId, versionId)` after authorizing the workspace, then recheck approval/current version when reserving a downstream action. Pending, Rejected, Archived and superseded versions are ineligible. An issued media URL does not prove approval. Future regenerated variants must produce their own successful execution and new Content/item version with explicit lineage and fresh review.

Remaining deployment work: production S3 CORS/lifecycle/retention/backups, dispatcher supervision, CPU FFmpeg availability, credential rotation, provider/network failure acceptance and capacity/latency monitoring. Bounded serial poster work shares dispatcher ticks; a dedicated supervised poster service may be appropriate at larger scale. There is no production cloud deployment acceptance in this phase.

BytePlus/Seedance and OpenAI analyzer credentials and controlled real-provider acceptance remain separate external gates. Missing credentials do not block fake-provider/deterministic Phase 6 acceptance. Do not begin Phase 7 from this handoff without a new authorized request.
