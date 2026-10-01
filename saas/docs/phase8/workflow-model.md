# Workflow model

Migration 0008_workflows.sql adds workflow_definitions, workflow_definition_versions, workflow_runs, workflow_steps, workflow_events, workflow_child_jobs and workflow_review_bindings. Jobs and ContentVersions receive nullable workflow_run_id/workflow_step_id. Existing records retain NULL; no historical Jobs or Content are rewritten. Migrations 0001–0007 are unchanged.

Definition is the reusable workspace configuration (DRAFT, ACTIVE, ARCHIVED). Saving an edit creates a new append-only version and moves the current pointer under a definition lock. The expectedVersionId check rejects stale editors. Archiving prevents new starts while retaining existing runs and history.

Run freezes exact DefinitionVersion, template/version, validated configuration, customer-authored prompts, prepared Product/rule/reference snapshots, sealed source identity, operation policies and initial maximum budget. Start inserts the Run, deterministic Steps and creation event atomically; it creates no paid child or wallet reservation. Same workspace request key and same canonical request returns the original Run; changed request returns 409. A missing explicit version chooses current at first start and preserves that choice on replay.

Run states: QUEUED, RUNNING, WAITING_FOR_FUNDS, WAITING_FOR_REVIEW, PAUSED, SUCCEEDED, FAILED, CANCELLED. Cancellation is recorded durably with cancel_requested_at while existing children resolve; UI shows Cancelling. BUDGET_EXCEEDED is a PAUSED scheduling block, distinguishable from customer pause and wallet shortage. Terminal runs retain their result and cannot mutate.

Steps store logical INPUT, SCRIPT_INPUT, AI_VIDEO, CLIPPER, REVIEW_GATE and COMPLETE stages. Unique run/step_key and immutable input/identity prevent replacement on replay. Child mapping has one Job per step, one child_key per Run, and one owning step per Job. Execution/provider/billing authority remains in existing Job tables. Composite workspace/run/step/Job FKs protect lineage; Content insertion automatically inherits Job lineage in a database trigger. Exact review bindings reference immutable ContentVersions in that same workspace and producer step.

DefinitionVersions, events, child mappings and review bindings reject UPDATE/DELETE. Run and step input mutations are guarded. Events use bounded safe metadata; no credentials, signed URLs, object keys or raw provider responses are included.
