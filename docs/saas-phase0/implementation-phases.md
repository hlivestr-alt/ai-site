# Implementation phases and gates

Estimates are **engineering workdays**, not calendar dates, for a small experienced team; exclude commercial provider onboarding, customer legal review, and external approval delays. Each phase should deliver a staging vertical slice, API/schema diff, test evidence and known issues. No phase below was started by this audit. Suggested sequencing preserves existing internal services while building a separate customer control plane.

| Phase / estimate | Scope and dependency | DB / APIs / UI / worker changes | Main risk and acceptance gate |
| --- | --- | --- | --- |
| **P1 SaaS foundation — 20–30** | New customer identity, signup/recovery, workspace creation/invites, Owner/Admin/Editor/Viewer; isolated staging; precedes all customer data | New SaaS Postgres `User/Workspace/Member/AuditEvent`; auth and workspace/member APIs; onboarding/Settings; no native worker edit | Cross-tenant authorization. Brand A/B ID substitution and role/spend denial pass on server; current internal site remains functional |
| **P2 Products + storage — 25–35** | Versioned Products, rules, reference photos/real footage, private R2/S3; depends P1 | Product/Version, Asset/Version/rights, Rule/Version; signed upload/confirm/download; Products wizard/detail; thumbnail service, no Clipper worker yet | Corrupt/public/cross-tenant media. Refresh/device reuse, archive history, checksum/MIME and Brand B URL denial pass |
| **P3 Persistent jobs + worker base — 20–30** | Common Job/outbox/attempt/lease, dispatcher/reconciler, Windows agent skeleton; depends P1–2 | Job, ProviderExecution, Worker/Lease/outbox; claim/heartbeat/progress/complete/fail APIs; job status UI; outbound-only worker, fixture executor | Duplicate claim/late lease. Ten fixture jobs finish after browser close/restart; stale lease fenced, no duplicate content |
| **P4 AI Video SaaS provider — 20–30** | VideoProvider interface/tier policy; official Seedance candidate bake-off then first provider; depends P3 | Provider config/executions, input snapshots; quote capabilities/submission/status/artifact APIs; Create Video real jobs; cloud adapter | Access/rights/reference fidelity/unknown submit. One real staging provider path with correct output/callback/recovery; no hardcoded vendor UX |
| **P5 Clipper SaaS worker — 30–45** | Extract headless transcription/analyzer/render pipeline; source upload to private worker; depends P2–3 | Transcript/clip plan metadata and content staging; Clipper submit/status APIs; Clipper job UI; per-job local dirs, signed object transfer | Native assumptions and product-specific prompt. Controlled source → transcript → ranked plan → clips → cloud result passes on separate staging worker, offline/retry tested |
| **P6 Content Library + Review — 20–30** | Lineage, protected preview/download, approval/rejection and variant relationship; depends P4–5 | Content/Version/Relation, ReviewDecision; search/download/review APIs; Library and Review Center UI; workers return validated manifests | Orphan output and rejected downstream content. Clip traces to source/product/rule/job/reviewer; Brand B denied |
| **P7 Tokens + sandbox payments — 25–40** | Price catalog/quotes, wallet ledger, atomic reserve/capture/release, Xendit sandbox candidate; depends P3–6 | Wallet/Ledger/Price/Payment/Event; quote/top-up/webhook/statement APIs; Billing UI; worker/provider success settlement hook | Double credit/negative balance. Two-device race, duplicate callback/webhook, timeout, refund and partial batch reconcile |
| **P8 Controlled workflow engine — 25–40** | Product → Script → Video → Clip → Review → Library template, budget/pause/resume; depends P4–7 | Definition/Run/Step snapshots; run/schedule/retry APIs; Workflows/create/run UI; dispatcher child scheduling | Recharging earlier steps or running rejected content. 2 scripts × 2 videos × 2 clips tree survives browser/worker restart and low-balance top-up |
| **P9 Paid beta hardening — 20–35** | Backups, alerts, admin/support, quotas, operational analytics, mobile essentials, acceptance script; depends P1–8 | Admin read/reconcile/audit actions; real metrics; no native system edits | Recovery and support gaps. Full owner script and tenant/media/billing disaster checks pass; terms/retention review completed |
| **P10 Customer Distribution + advanced analytics — 35–60** | Later only: customer-authorized account, own contacts/templates/campaigns, preview/freeze/confirm, stop/replies; attributable channel analytics | Workspace Integration/OutreachCampaign/contact tables; channel APIs; Distribution/Analytics UI; separate sender integration | Shared-account leakage or unwanted sends. Owned test account small batch only after confirm; no cross-workspace send; GMV/ROI only if verified feed |

Indicative total: **240–375 engineering workdays** across all ten phases, with P1–9 first paid release **205–315**. Re-estimate after provider/worker spikes. Staging proof gates are deliberately stronger than static screen acceptance.

**Proposed accountable roles:** P1 identity/backend lead with frontend and infrastructure support; P2 product/media backend lead; P3 job-platform/backend lead plus Windows worker engineer; P4 provider-integration lead; P5 Clipper/Python media engineer plus job-platform lead; P6 product/frontend lead; P7 billing/backend lead with finance/operations review; P8 orchestration/backend lead; P9 operations/security lead with product acceptance owner; P10 distribution/integration lead. Named people were not identified by the machine audit and should be assigned before each phase starts.

## Build later, not early

| Feature in target mockups | Dependency before implementation |
| --- | --- |
| Free-form visual workflow builder | Stable controlled templates, persisted step state and billing first |
| Creator matching and automatic Outreach | Customer-owned authorized channels/lists, sender policy and safe dispatch |
| Auto publishing | Channel permissions, content approval and audit |
| GMV, ROI, orders and creator performance | Authorized, attributable channel/sales source; show **Not connected** meanwhile |
| Elaborate recommendations | Reliable product/content/job outcomes and consented training data |
| Subscription/token plan complexity | Correct one-time top-up, ledger and refund reconciliation first |
| Broad analytics dashboard | Trustworthy job, review and ledger events first |

Early operational metrics may show jobs submitted, success/failure, processing time, videos/clips, approvals, token purchase/use by feature and worker utilization, each linked to real records. Internal provider cost/margin remains admin-only.
