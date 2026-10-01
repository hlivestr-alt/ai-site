# Controlled template registry

src/lib/workflow-templates.ts supplies typed validateDefinition, validateRunInput, planSteps, intendedChildren and reconcile contracts. The server accepts only PRODUCT_AI_VIDEO_REVIEW_V1 and SOURCE_CLIPPER_REVIEW_V1, template version 1. Unsupported keys, provider/model controls, storage keys and arbitrary graph settings are rejected.

PRODUCT_AI_VIDEO_REVIEW_V1 freezes an ACTIVE Product through the existing snapshot service and accepts 1–5 authored prompts of 20–2000 readable characters, 1–3 videos per prompt, QUALITY, 4–30 seconds and 9:16 / 16:9 / 1:1. Provider policy can impose narrower current capabilities. It uses existing compatible saved image selection and Product accuracy instructions. Maximum natural fan-out is 15, beneath the engine's hard 20-child guard. Default failure policy CONTINUE_PARTIAL; FAIL_FAST is supported. Prompts are input, not simulated or real AI-generated scripts.

SOURCE_CLIPPER_REVIEW_V1 freezes one finalized SourceAsset and optional ACTIVE Product. Language, goal, clip count (1–10), duration (10–90 seconds), captions and 9:16 use existing clipperRequest validation. Exactly one paid CLIPPER Job produces all clips. Failure policy is FAIL_FAST. Optional Product snapshots have no unrelated reference binaries in analyzer input.

Both use ALL_REVIEWED_AT_LEAST_ONE_APPROVED by default; ALL_APPROVED is also supported. Definition configuration and initial budget are immutable per version. Product edits apply only to new Runs. Source identity, sealed key, size, MIME and available checksum freeze at start; keys stay server-side.

Future compatible bindings may use StepOutputReference { producerStepId, outputKind, objectId, versionId }. A binding must authorize the referenced typed object/version and verify semantic/media compatibility. Raw keys, URLs and filesystem paths are never configuration bindings. Paid SCRIPT_GENERATION may be a future Job type. Neither extension executes in Phase 8.
