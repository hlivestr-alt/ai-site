# Phase 8 implementation and acceptance report

Date: 2026-10-01. Phase 8 is implemented and validated in the customer SaaS at `C:\Data\ai-site\saas`. Phase 9 has not begun.

## Migration

`0008_workflows.sql` adds seven tables:

| Table | Purpose |
| --- | --- |
| workflow_definitions | Workspace-scoped named, reusable DRAFT / ACTIVE / ARCHIVED configuration |
| workflow_definition_versions | Immutable template key/version and configuration, numbered per definition |
| workflow_runs | Frozen input, exact definition version, durable state, approved ceiling, request identity and result |
| workflow_steps | Deterministic logical stages with immutable identity/input and mutable observed state/output |
| workflow_child_jobs | Immutable association between an intended child, its step and the existing Job |
| workflow_events | Append-only bounded safe transition metadata |
| workflow_review_bindings | Immutable exact ContentItem / ContentVersion review references |

Jobs and ContentVersions gain nullable `workflow_run_id` / `workflow_step_id`. Existing rows retain NULL lineage. A publication insert trigger inherits lineage from the authoritative Job; the existing Content immutability trigger protects it afterward. No old Job or Content history was rewritten.

Composite workspace foreign keys bind versions to definitions, steps to runs, Jobs to steps, mappings to the exact Job tuple and review bindings to producer/version tuples. Unique constraints cover definition/version number, workspace/start request, run/step key, run/child key, one Job per workflow step and one child mapping per Job. Database guards prohibit version/event/mapping/review edits, run/step identity or input changes, Job lineage edits, run budget decreases, historical deletion and terminal run mutation. Run/step/event/result payloads and numeric values have bounds; `tokens_committed <= max_tokens` is enforced.

The current Phase 7 SaaS database was upgraded to 0008. Clean bootstrap through 0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008 passed. Migrations 0001–0007 are unchanged.

## Workflow model

The Definition is reusable configuration; an edit appends a DefinitionVersion and changes only its current-version pointer. An archived definition cannot start new runs, while prior runs remain accessible. A Run freezes the exact version, definition name, authored scripts, operation settings, review/failure policy, initial ceiling, Product/rules/reference versions and SourceAsset storage identity/size/MIME/available checksum.

Run states are QUEUED, RUNNING, WAITING_FOR_FUNDS, WAITING_FOR_REVIEW, PAUSED, SUCCEEDED, FAILED and CANCELLED. A durable cancellation flag exposes “Cancelling” while children settle. Steps represent INPUT, SCRIPT_INPUT, AI_VIDEO, CLIPPER, REVIEW_GATE and COMPLETE. Job, provider, worker and financial status remain in the existing systems; workflow state is a logical observation of them.

History, steps, outputs, authorized child links, review decisions, real costs and safe events are available through workspace-scoped services and the Workflow UI. Home displays actual active, review and funds counts. Viewer reads definitions/runs/results but cannot create, edit, archive, estimate paid work, start, control or increase budgets. Existing OWNER / ADMIN / EDITOR permission contracts authorize those actions.

## Templates

Only the typed server registry's two version-1 templates are accepted:

| Template | Controlled configuration |
| --- | --- |
| PRODUCT_AI_VIDEO_REVIEW_V1 | ACTIVE Product; 1–5 customer-authored prompts of 20–2000 characters; 1–3 videos per prompt; QUALITY; 4–30 seconds; 9:16 / 16:9 / 1:1; exact saved references; review/failure policy and ceiling |
| SOURCE_CLIPPER_REVIEW_V1 | One finalized SourceAsset; optional ACTIVE Product; existing language/goal/count/duration/captions validation; 1–10 clips; 10–90 second clip bounds; 9:16; review policy and ceiling |

AI Video defaults to CONTINUE_PARTIAL and optionally supports FAIL_FAST. Clipper uses FAIL_FAST. Both default to ALL_REVIEWED_AT_LEAST_ONE_APPROVED; ALL_APPROVED is also supported. The current AI provider policy may narrow supported duration/reference capabilities. Natural AI fan-out is at most 15, with an additional hard engine limit of 20 intended children.

There is no drag/drop graph, script provider, arbitrary browser-selected provider/model or automatic AI Video → Clipper chain. Scripts are authored by the customer. Future compatible bindings are documented as `StepOutputReference { producerStepId, outputKind, objectId, versionId }`; no executable future chaining or SCRIPT_GENERATION Job was added.

## Orchestrator

`npm run workflow:dispatcher` runs the separate workflow reconciliation process. Postgres is authoritative. It polls due nonterminal runs in bounded batches of 25; each transaction uses `FOR UPDATE SKIP LOCKED`, then locks the existing wallet for consistent financial observations/admission. It observes Jobs, JobBilling, publications and exact review state, repairs any missing mapping using immutable Job lineage, advances logical steps and admits at most two new children per run tick. Fair due timestamps prevent one waiting run monopolizing the batch.

The process executes no generation, transcription, rendering or external provider call. Existing dispatcher/provider/worker code executes paid child Jobs. Quotes, budget validation, paid admission, reservation, child mapping and step update share one transaction. A crash rolls uncommitted work back; replay admits only the same intended child. Independently running reconcilers safely skip a locked run. Browser polling displays state and never schedules work.

Waiting review/funds are safely polled. Browser closure and app/process restarts preserve run input, step IDs, already admitted Jobs, reservations and provider execution identity. Unexpected tick failures roll back and retry from durable state; safe logs report counts/error classes.

## Child Jobs

Stable identities are `video:01:01`, `video:01:02`, etc., and `clipper:01`; admission keys are `workflow:<run-id>:<child-key>`. Existing Job uniqueness plus one Job per step prevents replay/concurrency duplicates. Workflow creation itself admits no paid child.

Shared server preparation and paid admission are used by both existing AI Video / Clipper HTTP services and the workflow engine. Existing Product snapshots, validation, references, accuracy instructions, provider routing, Job/attempt/outbox insertion, reservation, retry, settlement and Content publication are reused. No second execution queue, billing implementation or review system was introduced.

Every admitted child gets its own current server Quote and immutable JobBilling price snapshot. Quotes are created shortly before admission; pending quotes are reused only while unexpired and still on the active PriceVersion, otherwise refreshed. Existing children are never repriced. A 402 admits no Job, attempt, outbox or reservation for the blocked identity. Child retry retains the same Job and billing lifecycle.

Definitive child failure/cancellation is observed from Job. Existing settlement releases its reservation when the outcome is certain. CONTINUE_PARTIAL preserves successful siblings for review and fails if no usable output remains. FAIL_FAST blocks further admission and uses existing sibling cancellation before terminal failure. Successful generation is neither regenerated nor refunded because of review rejection.

## Budget

`max_tokens` is a hard admission ceiling, with no upfront parent reservation. The initial ceiling is frozen in input; an authorized increase updates the current ceiling and emits a workflow event plus AuditEvent. Decreases are rejected. The application requires an integer amount within `WORKFLOW_MAX_TOKENS`; local default is 100000 and production requires explicit configuration.

Totals derive from existing child JobBilling, including authoritative Jobs even if a mapping requires repair:

| Value | Calculation / policy |
| --- | --- |
| Reserved | Sum of RESERVED child amounts |
| Spent / captured | Historical sum of CAPTURED and REFUNDED child amounts |
| Released | Sum of RELEASED child amounts; frees workflow capacity |
| Refunded | Separately reported REFUNDED amounts |
| Committed | Reserved + historical captured |
| Remaining budget | Current max_tokens − committed |

REFUNDED continues consuming the ceiling in v1 because there is no paid rerun policy. This policy is explicitly tested. `tokens_committed` is a refreshed projection; no independent ledger is maintained.

Each admission independently checks both committed + quote <= run ceiling and available wallet >= quote under the existing locks. Wallet shortage becomes WAITING_FOR_FUNDS / INSUFFICIENT_FUNDS and automatically retries after credit. Ceiling shortage becomes PAUSED / BUDGET_EXCEEDED; an increase or freed released amount may unblock it. Human PAUSED remains independent of these automatic financial waits. Neither workflow ceiling nor wallet balance can overrun.

## Pause / resume / cancel

Pause prevents new children while admitted children continue through existing execution, settlement and publication. Their observed step state can advance while the run remains paused. Resume schedules remaining identities once, without recreating successful children or reserving their costs again.

Cancel persists a request and immediately prevents new admission. Safe queued children use existing immediate cancellation; running/uncertain children use existing cooperative/reconciliation semantics. The run stays visibly Cancelling until admitted children become authoritative terminal and their reservations settle. Successful children retain captures and Content; unscheduled operations become CANCELLED and review gates are skipped. The workflow layer performs no release/refund. FAIL_FAST uses these same child contracts and marks unscheduled work SKIPPED before FAILED / CHILD_FAILED.

## Review

Published child manifest artifacts bind exact ContentItem / ContentVersion IDs through immutable Job lineage. Binding does not search by Product, filename, time or latest output. Gate evaluation uses existing `isContentApproved` and version/review revision identity.

The default policy waits for every produced output's decision and requires at least one approved output. Two approvals plus two rejections succeeds only after all four decisions. All rejected yields FAILED / NO_APPROVED_CONTENT, retaining rejected history and successful generation charges. ALL_APPROVED additionally requires every output approved. No usable output yields NO_USABLE_CONTENT without fabricated Content. A replaced/archived bound version safely fails CONTENT_VERSION_UNAVAILABLE; its old approval cannot approve another version. Later review changes do not rewrite a terminal result.

Review occurs in the existing Content / Review Center UI. Safe final results contain approved/rejected Content IDs, exact version outcomes, child Job IDs and authoritative captured/released/refunded totals. No review action moves Tokens.

## Lineage

The verified chain is **ContentVersion → Job → WorkflowStep → WorkflowRun → DefinitionVersion**. Publication inherits workflow lineage automatically from Job while retaining existing Product/rules/references, source, provider execution and worker/attempt/artifact lineage. Authorized child and Content pages link back to their run. Customer run responses omit storage keys, signed URLs, provider internals, credentials, quote hashes and raw ledger IDs.

Cross-workspace substituted definition/run IDs are denied for reads and controls. Run responses scope versions, steps, mappings, events, outputs, budgets and results to that workspace. Workflow-produced Content detail, exact-version media and review are also denied to another workspace. Database constraints reject foreign Job mappings/lineage and immutable history edits.

## Acceptance

The persisted reports in `saas/data/phase8` contain test run IDs and numeric evidence. They are local acceptance artifacts, not production records.

| Scenario | Verified result |
| --- | --- |
| Primary AI workflow | 2 authored prompts × 2 videos = 4 intended children, 4 actual Jobs, 4 distinct admitted Quotes, 4 reservations, 4 captures, 0 releases, 4 ContentItems; 2 approved + 2 rejected; SUCCEEDED; 2800 captured Tokens; 4 complete lineage rows |
| Clipper workflow | 1 paid Job, 2 fenced attempts, 1 reservation, 1 capture, 2 deterministic clips; 1 approved + 1 rejected; SUCCEEDED; fixture worker process stopped/replaced; 0 transcription/analyzer calls |
| Low balance | First child admitted once; second unscheduled; WAITING_FOR_FUNDS; TEST funding resumes the same run/step; no duplicate first child |
| Pricing / ceiling | First child keeps price v1 at 700; expired pending quote refreshes after price v2; next 900-token child blocks on ceiling, then one authorized increase admits it once |
| Refund policy | One refunded successful child still consumes 700 of a 700 ceiling; no automatic rerun or second reservation |
| Pause / resume | First two of four children finish while paused; no new children; resume admits only the remaining two once |
| Cancel | One succeeded capture retained, running child uses existing cancellation, unscheduled child never created; run becomes CANCELLED after settlement |
| Partial failure | Three successful children capture, one definitive failure releases; successful siblings review and run succeeds |
| All failure / fail-fast | No fabricated Content or review success; releases belong to child settlement; fail-fast creates no pending siblings |
| Review | Mixed decisions succeed; all rejected fails without refund; exact old-version approval cannot satisfy a replaced-version gate |
| Concurrent replay | Two reconcilers and an eight-process stress race; one child and one reservation per identity; 100 reconciliation ticks add no duplicate work |
| Reconciler crash | Actual process exit after READY and after admission-before-link/update; both transactions recover to one child/reservation |
| App / dispatcher restart | Three app and three workflow process restarts plus execution dispatcher restart; original run snapshot/steps/prior child/reservation IDs retained; 4 ProviderExecutions and 4 submissions, one each |
| Waiting-state restart | WAITING_FOR_REVIEW survives app/reconciler restart and later reviews complete it; WAITING_FOR_FUNDS survives restart and later TEST top-up continues the same child identities |
| Browser closure | Entire browser context closes after Start; backend stages continue; return to review outputs and complete run; desktop/mobile layouts checked |

Evidence: `ai-acceptance.json`, `clipper-acceptance.json`, `funds-acceptance.json`, `concurrency-acceptance.json`, `restart-acceptance.json`, `billing-proof.json`, and `workflow-review.png`, `workflow-success.png`, `workflow-mobile.png`.

## Billing

The primary run's child ledger is exactly **4 RESERVE + 4 CAPTURE**. The Clipper Job's ledger is exactly **1 RESERVE + 1 CAPTURE**, covering both clips; two attempts do not add a second reservation. The partial-failure run has **4 RESERVE + 3 CAPTURE + 1 RELEASE**. Each child uses the existing once-only terminal settlement identity.

Parent workflow direct paid ledger movements: **0**. The parent has no JobBilling or paid Job identity and makes no direct reserve/capture/release/refund call. All monetary movement uses the shared child admission/settlement contracts. Review, pause/resume, estimates, repeated reconciliation and parent cancellation introduce no independent movement. Funds are provided by Phase 7 TEST grants/fake payments; no PRODUCTION prices/packages were created.

The final read-only `billing-proof.json` independently queries both acceptance workspaces: each intended Job has exactly one RESERVE and one CAPTURE, with no other paid ledger movements or debit without a Job. Available and reserved wallet balances match the complete ledger sums.

## Validation

| Check | Result |
| --- | --- |
| Unit tests | 19 passed, including 5 new workflow unit tests |
| Full Phase 1–8 integration/browser regression | All 37 passed (7.9 minutes), including the legacy payment fixture correction |
| Strengthened worker / Content isolation checks | Both passed separately after adding actual deterministic fixture worker process termination/replacement and direct workflow-produced Content checks |
| Phase 8 coverage | 12 integration scenarios + 1 browser journey; concurrency, crash, low funds, ceiling/pricing/refund, controls, failure/review, lineage and workspace/Viewer checks |
| Workflow restart acceptance | Passed with actual app/workflow/execution process restarts, review wait and funds wait recovery |
| Worker Python unit tests | 10 passed; no GPU transcription |
| Migration upgrade and clean bootstrap 0001–0008 | Passed; prior migrations unchanged |
| Lint | Passed |
| Typecheck | Passed |
| Production build | Passed; workflow pages and API routes generated |
| Desktop/mobile visual inspection | Passed; mobile navigation wrap prevents horizontal overflow |

The existing Phase 7 payment test now waits for its specific payment across bounded reconciliation batches. Reused isolated databases can retain more than one batch of unrelated pending payments; financial assertions and production reconciliation behavior are unchanged. The old real-GPU Clipper acceptance command was not run: deterministic fixture execution and existing worker unit coverage satisfy this phase without another transcription.

Final logs: `data/phase8/full-final-test.log`, `worker-isolation-final-test.log`, `lint-final.log`, `typecheck-final.log`, `build.log` and the restart acceptance report. The final test run uses the configured isolated TEST database and storage bucket. Failed test fixtures were cancelled through existing child cancellation/settlement contracts; their reservations released without parent billing.

## Phase 9 handoff

Paid beta hardening remains future work, documented in `phase9-handoff.md`. Required supervision: Next.js SaaS, execution dispatcher, workflow dispatcher and private Windows worker. Payment reconciliation and poster processing currently run inside the existing execution dispatcher; bounded standalone billing/content commands remain operator repair tools.

Available signals are authenticated worker heartbeat/claim APIs, Job/Workflow status APIs and safe dispatcher logs. Dedicated readiness/health/metrics endpoints remain a gap. Monitor overdue workflow ticks, waits, uncertain executions, settlement/publication/poster backlog, stale worker heartbeats and wallet/ledger consistency.

Back up SaaS Postgres plus sealed private storage and verify coordinated restore of snapshots, ledger, exact review/version links, artifacts and source identity. Establish source/reference/output/poster retention and cleanup policies. Admin/support needs include tenant/run lookup, stalled gates, safe reconciliation tools, uncertainty/billing support and user recovery procedures. Paid beta still needs per-workspace active-run/admission limits, API/storage quotas, alerts, production email delivery and recovery verification.

Production blockers include approved pricing/packages, deliberately configured workflow ceiling, independent provider credentials, supervised processes, private storage, restore evidence and retention/terms. Real BytePlus generation, OpenAI analyzer and Xendit sandbox create/webhook/query/recovery acceptance remain required. No deployment or Phase 9 implementation was started.

## External status

| Check | Status |
| --- | --- |
| BytePlus credential configured | NO |
| OpenAI credential configured | NO |
| Xendit sandbox credential configured | NO |
| Real Seedance calls during Phase 8 | 0 |
| Real OpenAI analyzer calls during Phase 8 | 0 |
| Real Xendit attempts during Phase 8 | 0 |

Credentials were checked only for presence; no values were logged. Acceptance uses fake video/payment providers and deterministic Clipper fixture outputs. Credentials are not required for Phase 8 validation.

## Safety

| System / activity | Changed / count |
| --- | --- |
| Internal AI Site changed | NO |
| H3 Bridge changed | NO |
| Creative Studio changed | NO |
| Native Clipper changed | NO |
| Native Clipper DB/schema changed | NO |
| Outreach changed | NO |
| Native Outreach DB changed | NO |
| Native production Clipper jobs | 0 |
| Outreach campaigns | 0 |
| Creator messages | 0 |
| Production payments | 0 |

Source/schema changes are confined to the SaaS. Private worker source and all internal/native systems are unchanged. There is no customer Outreach, distribution, subscriptions, advanced analytics, new script-generation subsystem, production provider acceptance or AI Video → Clipper chaining. Work stops after Phase 8.
