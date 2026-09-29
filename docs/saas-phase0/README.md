# Phase 0: current system audit and SaaS plan

Audited 2026-09-29 (Asia/Shanghai). **Planning only.** No service, schema, runtime configuration, customer account, payment, campaign, or provider job was changed. Current facts are marked **observed** (read-only host/API inspection), **source** (current code), or **historical** (older project documents). A source-only feature is not proof of a successful live run.

## Decision summary

The paid product needs a new workspace-scoped Postgres control plane, private object storage, persistent jobs, worker leases, a token ledger, and payment reconciliation. Keep the current AI Site visual shell as a starting point; keep the H3 bridge and native systems independent during migration. Use the local Clipper pipeline through an outbound-only private Windows worker after extracting an explicit job boundary. Do not expose the shared internal Outreach sender to customers.

The first paid release is signup → workspace → product → controlled workflow and quote → sandbox top-up → background video and clipping → review → protected download → token reconciliation. The 17 PDFs screens are targets with sample data, not current functionality. The employee guide's staged implementation instructions are reference material; the user's Phase 0 read-only constraint governs this audit.

## Reading order

1. [Current inventory](current-system-inventory.md), [runtime map](current-runtime-map.md), [current pages/APIs](current-page-api-matrix.md)
2. [AI Video](ai-video-audit.md), [Clipper](clipper-audit.md), [Outreach](outreach-audit.md)
3. [Architecture](proposed-saas-architecture.md), [schema](proposed-database-schema.md), [jobs and workers](job-worker-design.md)
4. [Storage](storage-design.md), [tokens and payments](token-billing-design.md), [isolation](security-and-isolation.md), [failure modes](failure-modes.md)
5. [17-screen gap matrix](target-gap-matrix.md), [reuse decisions](reuse-matrix.md), [phases](implementation-phases.md), [Phase 1 checklist](phase1-ready-checklist.md)

## Evidence and limits

- Inspected the repositories under `C:\Data\ai-site`, `C:\Data\Clipper Ai Trends`, `C:\Data\proya-creative-studio`, and `C:\Data\TikTok Outreach`; listener/process metadata; `docker ps`; and safe health/history GETs. No DB write or schema query was run. Existing docs were checked against current source and runtime.
- The live bridge reports 4–15 seconds, four portrait resolutions, and generation available. Older documentation describing only 8 seconds is stale. Three historical jobs were reported completed by the bridge; this audit triggered zero generations. The read-only job list is architectural evidence, not a new end-to-end test.
- Clipper 8765/5173 were not listening; a fresh live Clipper run and API control authentication could not be verified. Native source and persisted architecture were inspected. We do not claim current customer-safe job submission.
- Outreach containers were healthy by Docker status; its read endpoints may mutate expiry state, so no native campaign GET was called for this audit. AI Site's existing internal sending integration was classified from source. No campaign or message was sent.
- Cloudflare's `Cloudflared` Windows service was running. The existing route to AI Site 3100 is documented in `app/docs/platform-operations.md`; the current dashboard route was not independently fetched because the tunnel configuration/credentials are outside the audit. Treat public reachability as a live risk requiring operator verification.
- Payment facts were checked against provider documentation on 2026-09-29; onboarding, contract terms, settlement, and fees must be reconfirmed before Phase 7.

## Source material

- `Employee_Implementation_Guide_EN_v2.pdf` (8 pages), `Page_by_Page_Explanation.pdf` (8 pages), and `UI_Walkthrough_17_Pages.pdf` (17 image-only pages), supplied at `C:\Users\lbbch\Downloads\WhatsApp Unknown 2026-09-29 at 10.40.46`. All guide/explanation pages were text-inspected and the 17 mockup pages visually reviewed as a contact sheet.
- Current source files and existing `app/docs/*` and Clipper `docs/ARCHITECTURE.md` / `docs/DATA_AND_STORAGE.md`. Paths in the topic files make conclusions reviewable.

## Immediate launch blockers

No customer identity/tenancy; no protected workspace media; no SaaS-owned product/content/workflow records; no durable SaaS queue or Clipper worker lease; no shared provider abstraction; no ledger/price quote/payment reconciliation; no customer isolation tests or support console. `AUTH_ENABLED=false` and internal one-click Outreach are intentional **current internal** settings, never target SaaS defaults.
