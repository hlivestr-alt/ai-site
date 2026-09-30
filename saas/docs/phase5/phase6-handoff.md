# Stable Phase 6 handoff

Lineage ready: workspace SourceAsset ID/SHA → immutable job input hash/settings/Product version/rule version → schema-v3 transcript artifact/fingerprint → schema-v1 plan artifact with transcript ID, analyzer provider/model/policy/usage → approved clip slots and current-attempt private READY JobArtifact IDs/SHA/geometry → job result clip metadata.

Content Library/Review may reference these existing immutable IDs and sealed object identities without copying signed URLs or local paths. Product is optional and frozen. Result schemaVersion 1 includes sourceAssetId/sourceSha256, transcriptArtifactId, planArtifactId, artifactIds, requestedClipCount, clips, analyzerPolicyVersion, renderPolicyVersion and pipelineVersion.

Do not treat checkpoint artifacts from lost attempts as customer-published content; use successful job result membership. Future source origin READY_JOB_ARTIFACT needs same-workspace authorization and immutable artifact identity. Future external analyzer credential centralization preserves TranscriptAnalyzer protocol.

This phase introduces no review/approval/variants/ContentItem schema, wallets/payments/token deductions, AI Video→Clipper workflow chaining, outreach or creator distribution. Phase 6 has not begun. Production rollout still needs OpenAI model/credential configuration, provider acceptance, cloud multipart/lifecycle deployment verification and normal operations/backups.
