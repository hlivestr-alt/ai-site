# Seventeen-screen parity audit

Requested November 3, 2026; evidence refreshed November 4, Asia/Shanghai. Current revision **`530e81b21bf6b9f1797cba57dcb2dd4d2402b831`**, build **`DW_qT5DJOl3qpjSs-WD8c`**.

Reference: all 17 pages of [UI Walkthrough](<C:/Users/lbbch/Downloads/WhatsApp Unknown 2026-09-29 at 10.40.46/UI_Walkthrough_17_Pages.pdf>), read together with [Page-by-Page Explanation](<C:/Users/lbbch/Downloads/WhatsApp Unknown 2026-09-29 at 10.40.46/Page_by_Page_Explanation.pdf>) and the [Implementation Guide](<C:/Users/lbbch/Downloads/WhatsApp Unknown 2026-09-29 at 10.40.46/Employee_Implementation_Guide_EN_v2.pdf>). Sample mockup values are not requirements to seed real accounts.

## Evidence and limits

Every reference screen was visually inspected. The actual deployed component/route source was inspected for fields, navigation, server calls, errors and permissions. Current application read functions retrieved real Product, Library, Workflow, Review, Billing and Analytics data under database-enforced read-only connections. Selected actual historical desktop/mobile screenshots were visually inspected, including the newer Workflow/Review/Analytics layouts. They are available in [labelled historical contact sheet](C:/Data/ai-site-audit-2026-11-03/evidence/historical-ui-contact.jpg) and the original stage reports.

The browser bridge timed out. **Zero of the 17 screens received a new authenticated browser visual/action acceptance during this audit.** Historical screenshots are not labelled as current GUI proof. Fresh save/upload/approve/reject/start/payment tests were prohibited by the read-only instruction. Therefore this is a complete reference-to-implementation comparison with explicit acceptance gaps, not a claim of seventeen newly passed UI tests.

Current source root, referred to below as `R`:

`C:/Data/ai-site/saas/data/test1-workflow-stable-20261102/pilot-848267e3/clipper-completion-20261103/releases/release-530e81b21bf6/saas`

All `R/...` references resolve under that verified immutable release. The [CSV](C:/Data/ai-site-audit-2026-11-03/ORIGINAL_PDF_REQUIREMENTS_MATRIX.csv) contains full absolute paths and anchored lines. Current reads are in [application-readonly.json](C:/Data/ai-site-audit-2026-11-03/evidence/application-readonly.json); anonymous route observations are in [http-readonly.json](C:/Data/ai-site-audit-2026-11-03/evidence/http-readonly.json).

## Overall comparison

The deployed design retains the reference's orange-accent workspace shell, Product-first structure, cards, forms and output review. It has additional Assets, Variant Edits, Jobs, Batches and legacy Outreach surfaces. New Workflow and Review views are denser and longer than the compact mockups. This layout difference is not itself a functional defect; it increases the importance of navigation and phone acceptance.

The material differences are operational. The current account shares Tokens across Workspaces, customer signup/top-up are closed, new Workflow surfaces are preview-scoped, and the only real production graph is a paused one-script pilot with pending media approval. Historical synthetic records can make screenshots and counters look busy without establishing a paying customer workflow.

| # | Original screen / current route | Functional parity status | Main current gap |
| --- | --- | --- | --- |
| 01 | Home `/` | PARTIAL | Failure-focused next actions and fresh empty/foreign Workspace acceptance. |
| 02 | Products `/products` | PARTIAL | Product reuse/list exists; general Workflow action and fresh complete customer lifecycle are not accepted. |
| 03 | Add Product Basic `/products/new`, saved edit | PARTIAL | Current save/cross-device validation untested; draft-SKU uniqueness narrower than specified. |
| 04 | Add Product Assets, wizard step 2 | PARTIAL | Full authentic reference/usage pack not accepted; historical missing media remain. |
| 05 | Accuracy Rules, wizard step 3 | PARTIAL | Stored frozen rules verified; fresh edit-during-run/customer review acceptance outstanding. |
| 06 | Product Detail `/products/:id` | PARTIAL | Real detail works; reusable complete Workflow history and historical media remain incomplete. |
| 07 | Create Video `/ai-videos` | PARTIAL | QUALITY/single standalone quantity scope and current customer action acceptance. |
| 08 | Clipper `/clipper`, `/clipper/:jobId` | PARTIAL | Ordinary automatic analysis/recovery acceptance; original pilot needed an explicit deterministic correction. |
| 09 | Workflows `/workflows` | DISABLED | Normal customer rollout/execution gated; only the fixed pilot has actual history. |
| 10 | Create Workflow `/workflows/new`, saved definition | DISABLED | Full form exists but ordinary 2x2x2 start/pricing/admission remain closed. |
| 11 | Workflow Run `/workflows/runs/:runId` | DISABLED | Current run PAUSED; generic resume, retries, funds recovery and original-scale acceptance not available. |
| 12 | Review Center `/review`, exact-version detail | PARTIAL | Scoped preview/data works; real production Content decisions zero and paid regeneration gated. |
| 13 | Content Library `/content`, `/content/:id` | PARTIAL | Search/lineage/media verified, but approved final workflow and retention/deletion acceptance incomplete. |
| 14 | Distribution `/distribution` and child pages | DISABLED | No certified real customer channel, recipients or send batches. |
| 15 | Analytics `/analytics` | PARTIAL | Actual report exists; general customer page access and complete production/review acceptance outstanding. |
| 16 | Billing `/billing`, packages `/tokens` | PARTIAL | Packages/checkout closed, no current payments, statement missing, new operation links broken. |
| 17 | Settings `/settings` | PARTIAL | Notification controls missing; current invitations/role/removal/integration acceptance incomplete. |

Status summarizes functional parity, not a fresh visual PASS. Pages 09-15 are subject to the test1-only website-preview guard; a normal unrelated customer receives hidden/404 feature routes even where read-only implementation exists. The public login and health page returning 200 do not change those availability conclusions.

## Screen-by-screen findings

### 01. Home Dashboard

**Original contract:** Workspace-scoped Token balance, active Workflows, pending reviews, failures and next actions; new-user Add Product guidance; every count opens its underlying records. Reference page 1; explanation page 1; guide page 6.

**Current:** `R/src/app/page.tsx` queries actual Product, Job, Content, team and Workflow state. It includes Add a Product onboarding, Content Pipeline, Review/action links, recent Content and usage. The audited account's balance is 5,385 available, with 0 reserved. Usage is explicitly the latest 50 billable operations, which is preferable to calling that number an unverified monthly total. Account-level balance differs from the Workspace-wallet requirement.

**Gaps/UX:** the inspected Action Center emphasizes review and active Jobs; a dedicated failed-job recovery action is missing. General Workflow navigation depends on rollout flags. New-account empty state, count-to-record navigation, unrelated Workspace counts and phone visibility have not been newly browser-tested. Severity **P1**. Finish the actionable failure view and accept real empty and populated accounts without synthetic sales figures. Matrix S1-23/24, S3-01.

### 02. Products

**Original contract:** searchable cards with SKU/category/status/references; add/open/generate/create Workflow; archive safely; reuse one Product across runs. Reference page 2; explanation page 1.

**Current:** scoped deployed list reads return three current Products in the audited Workspace. Search for Orange returns a matching Product; stored Product/rule versions and asset references persist. Source `R/src/lib/products.ts` and `R/src/app/products/page.tsx` implements search, status filtering, detail links, covers and creation actions.

**Gaps/UX:** ordinary Create Workflow cannot complete because the workflow preview/execution is gated. Stable has only one definition/run, not two completed independent Workflows reusing the same Product. Covers for old lost files may be unavailable even when metadata exists. Card actions, filters and mobile navigation need fresh GUI acceptance. Severity **P1**, with customer Workflow admission **P0**. Matrix S1-11/20/21/22.

### 03. Add Product Basic

**Original contract:** brand/name/category/SKU/description/benefits/audience, required-field validation, Workspace SKU uniqueness and durable drafts. Reference page 3; explanation page 2.

**Current:** `R/src/components/product-wizard.tsx` has Basic Info, Product Assets and Accuracy & Review steps, required fields, limits, Save draft and Continue. Draft writes and versioning are persistent server operations, not browser-only placeholders.

**Gaps/UX:** `products_active_sku` only enforces uniqueness for ACTIVE Products, narrower than the explanation's unqualified Workspace rule. No new invalid-field/save/reload/cross-device test was submitted. Dense fields have responsive source styling; actual phone keyboard/focus/error placement is unverified. Severity **P1**. Accept the uniqueness policy, then verify the final server-backed form with a brand-new customer. Matrix S1-12/13/14.

### 04. Add Product Assets

**Original contract:** front/back/side, packaging, cap/pump, texture and real usage photos/video, source/rights/purpose/version, validation, thumbnails and private access. Reference page 4; explanation page 2.

**Current:** wizard step 2 uses ProductReferences and versioned asset APIs. UI limits currently say images up to 20 MiB and MP4 up to 500 MiB. Validation and private object storage are implemented. The current pilot Product detail contains **one** reference asset; it is not evidence of the complete required photo/footage pack.

**Gaps/UX:** a full owned pack, invalid/corrupt/oversize file handling, thumbnail generation, rights metadata, refresh and foreign access have not been freshly accepted together. Fresh R2 HEAD checks show 38 historical originals and 36 thumbnails remain absent. Metadata READY is not proof of retrievable bytes. Upload progress, retry and phone selection need current GUI acceptance. Severity **P0** for new-customer acceptance; existing historical loss **P1** with truthful disclosure. Matrix S1-15/16/17/22.

### 05. Product Accuracy Rules

**Original contract:** preserve logo, text, shape, cap/pump, color and application method; custom rules; saved summary; immutable snapshots into Jobs and Review Center. Reference page 5; explanation page 3.

**Current:** versioned accuracy-rule records and the actual pilot's Product/rule identities are retained. Existing paid Script, Video and Clipper inputs bind those identities. The wizard provides the corresponding rule controls and review/save step.

**Gaps/UX:** no fresh edit-during-run acceptance was performed. The owner must verify that replacing Product references/rules does not change an already-started job and that Review displays the frozen originals. Rule checkboxes cannot guarantee visually correct AI packaging. Mobile rule review and error states remain unverified. Severity **P0** within final Product/accuracy acceptance. Matrix S1-18, S2-05, S5-04.

### 06. Product Detail

**Original contract:** permanent SKU home with references, rules, asset versions, replace/edit/archive and related Workflows; a completed result navigates to the exact original revisions. Reference page 6; explanation page 3.

**Current:** deployed `getProductDetail` returns an ACTIVE Product with assets, current rules and Product/rule revision histories. Detail and Content/Workflow source preserve snapshot links.

**Gaps/UX:** this proves current read behavior, not fresh replace/archive/history actions. General multi-Workflow reuse remains gated; older missing payloads can break historical retrieval. The actual run's media are pending, so approved-result-to-reviewer acceptance is not complete. Desktop reference presentation exists in historical evidence; phone preview/version navigation needs new acceptance. Severity **P1**. Matrix S1-19/20/21/22.

### 07. Create Video

**Original contract:** saved Product or explicit one-off, goal, prompt, quality, duration, ratio and quantity; internal provider routing; quote before submit; durable idempotent jobs and stored output. Reference page 7; explanation pages 3-4.

**Current:** real Seedance processing exists. QUALITY routing is internally configured; allowed duration is 4-30 seconds, ratios include 9:16/16:9/1:1, at most four image references, standalone quantity one. The real pilot used a 20-second 720p 9:16 video with one reference and reviewed narration. Quote/input/price and provider submission identities persist.

**Gaps/UX:** additional tiers and general standalone quantity are unavailable. Do not equate the Workflow count controls with a generally enabled standalone batch. Fresh quote display, double-click, insufficient funds, prompt validation and closing the browser need the final admitted-customer acceptance. That audit did not call quote POSTs because they persist records. Severity **P0** for the customer path; wider tier/quantity breadth can be **P2** if not sold in beta. Matrix S2-01 through S2-05.

### 08. Clipper

**Original contract:** source/Product selection, style/length, quote, integrated job/progress/errors/retry, stored outputs, lineage and download. Reference page 8; explanation page 4.

**Current:** Native/ASR/analysis/rendering is genuinely integrated; Worker is ACTIVE with one slot. Larger Native paid jobs with **20 and 62 artifacts** are SUCCEEDED and CAPTURED, confirming that the October 23 generic settlement-size defect no longer describes the deployed system. The official pilot clip is a valid current 10-second 720x1280 MP4.

**Gaps/UX:** the original automatic pilot attempt failed `ANALYZER_INVALID_CANDIDATES`; its successful successor used an explicitly bounded deterministic selection. Normal automatic selection, short-speech handling and recovery still need acceptance. A failure's generic “try again” guidance is insufficient if paid retry is actually closed or the provider outcome is uncertain. Imported Native catalog access remains intentionally restricted; it is not general customer asset entitlement. Large-source upload/mobile settings/media playback need candidate acceptance. Severity **P0**. Matrix S0-04, S2-06/07/08/21.

### 09. Workflows

**Original contract:** real persisted runs with filters, progress, review/funds/failure actions and restart/refresh accuracy. Reference page 9; explanation page 4.

**Current:** the actual deployed list read returns one definition and one PAUSED run, 3,475 spent, 0 reserved and two awaiting reviews. Full list/filter source exists. Historical screenshots show real persisted fixture runs, not a hardcoded card table.

**Gaps/UX:** ordinary customer visibility and execution remain gated. This is intentional unavailability, not an absent engine. No current ordinary-account list/action/refresh or phone acceptance is certified. Distinguish production-Job completion from review completion so the current run cannot look finished. Severity **P0**. Matrix S4-01/09/15.

### 10. Create Workflow

**Original contract:** Product first; UGC/Demo/Batch; channel ratio/language; script/video/clip plan; quality/review/budget; separate Save Draft and Start; predicted job count and cost. Reference page 10; explanation page 5.

**Current:** the newer controlled production form supports the required plan, immutable snapshots and review/budget confirmation, plus explicit Script/TTS options. Historical screenshots show product/production-plan/review-budget/confirmation steps. This is a substantial implementation improvement over October 23.

**Gaps/UX:** current global Script/TTS catalog pointers are inactive and general execution is off. The sealed pilot permits a fixed one-script DEMO, not arbitrary new customer 2x2x2 starts. The added speech/price choices make the form denser than the mockup; desktop-first configuration is permitted by the guide, but it still needs usable phone status/review/billing. Severity **P0**. Matrix S4-01 through S4-04, S3-06.

### 11. Workflow Run

**Original contract:** clickable parent/child nodes, input/output/errors/cost, counts, pause, resume, retry, review and funds recovery after browser/Worker restart. Reference page 11; explanation page 5.

**Current:** durable steps, child Jobs, Script/audio versions, review bindings and exact production lineage exist. The actual run has successful Script/TTS/Video/Clipper generation, two WAITING review gates and a PENDING COMPLETE step. Runtime status is PAUSED.

**Gaps/UX:** do not label this “completed Workflow.” Existing technical approval did not approve creative packaging quality. General resume, budget changes, retry/regeneration and additional runs are blocked by the closed manifest/global gates. Historical run pages are long and detailed; current node navigation, count consistency and phone status lookup are unverified. Severity **P0**. Matrix S4-07 through S4-15.

### 12. Review Center

**Original contract:** original references beside generated frame/video, structured accuracy flags, approve/reject/regenerate with reasons, identity/time/version, and actual downstream gating. Reference page 12; explanation pages 5-6.

**Current:** deployed queue/context reads return 125 pending items in the audited Workspace and exact original/reference/generation/Script context for the official clip. Real-record pending counts are not customer approvals. Stage 5 historical fixture acceptance exercised decisions, notes/issues, stale-version checks, linked regeneration and blocked rejected branches.

**Gaps/UX:** Stable has zero Content review decisions; real Video and clip remain PENDING_REVIEW. New paid regeneration is closed, and preview page visibility is restricted. The 125 pending items include test/diagnostic history and cannot be described as 125 completed customer productions. Actual compare/play/flag/reason/button behavior and mandatory mobile review need final GUI acceptance. Severity **P0**. Matrix S5-04/05/06/08/09.

### 13. Content Library

**Original contract:** search/filter/preview/download; versions and complete Product/Script/Workflow/Job/reviewer/cost lineage; approve/reject/variant/send-to-Clipper/archive; protected files and retention. Reference page 13; explanation page 6.

**Current:** current read returns 125 active items in the audited Workspace. Search by official Job ID finds the exact clip; search by Workflow ID finds its two media outputs. The clip's production lineage names parent Video version, Script/audio versions, Product/rule versions and Job/billing identities. Fresh R2 reads verified actual source and clip bytes. Retained same-build browser playback reached the end without media error.

**Gaps/UX:** no approved current pilot media/reviewer, no retention setting or statement of enforceable deletion lifecycle, and 125 historical lost objects remain missing. “Register variant” on the older Content action component links existing items; it is not by itself a generation operation. Newer Review/Native controls must be accepted for actual version creation. An owner may preview/download pending media; that does **not** give it approval or distribution eligibility. The guide requires an approved downloadable journey, not a blanket ban on viewing pending output. Severity **P0** for final approved lineage and privacy; retention/parity **P1**. Matrix S2-13 through S2-20, S5-09.

### 14. Distribution

**Original contract:** customer-authorized account/content/recipients; Preview -> Freeze -> Confirm; Creator ID dedup, cooldown/exclusion/consent, bounded sends, stop and auditable campaign results/replies. Reference page 14; explanation pages 6-7.

**Current:** extensive customer list/import/freeze/confirm/queue/proof UI and schema are deployed. Isolated TEST adapter acceptance exercised 30 synthetic creators, 24 frozen recipients, confirmed/failed/stopped/unknown outcomes and safe recovery. Stable customer Distribution tables and channel credentials are empty; real sending is off.

**Gaps/UX:** no certified real customer channel, supported template/event contract, or genuine customer send batch. TEST sends cannot certify TikTok/WhatsApp/Instagram/email sending. Scheduling and commerce data are Not Connected. Empty/disabled state must stay truthful; do not sell visible controls as live execution. Severity **P2 for the first content launch**, required before selling Distribution. Matrix S6-01 through S6-08/13.

### 15. Analytics

**Original contract:** reconcilable generation success, approvals, outputs and Token metrics from actual Jobs/ledger; actual provider cost admin-only; no invented sales/ROI. Reference page 15; explanation page 7.

**Current:** the dedicated deployed report exists, unlike October 23. It computes 77 measures with source inspection, filters and scoped export. Current direct reads show one Workflow, 3,475 Workflow Tokens, one Script and one audio output, no completed Workflow, and no approvals. Commerce/channel status is NOT_CONNECTED. Percentages with no terminal/review denominator correctly remain unavailable rather than invented zeros.

**Gaps/UX:** general page access is preview-restricted; full live multi-output/review reconciliation and phone/source-export acceptance remain outstanding. The audited Workspace includes historical diagnostic outputs; its aggregate 120 clip outputs are persisted records, not proof of 120 paid customer jobs. Actual provider costs/FX/margin are Not Connected in the operator panel. Severity **P1** for customer/report acceptance; sales integrations **P2**. Matrix S6-09 through S6-12.

### 16. Billing and Tokens

**Original contract:** Workspace wallet, available/reserved balances, clear packages, payment flow/history, append-only ledger, releases/refunds and statement export; exact idempotency/reconciliation. Reference page 16; explanation page 7.

**Current:** actual summary is 5,385 available/0 reserved. Account history is paginated; the current read returns 50 recent entries. All 14 ledger checks are clear. Prices/quotes/captures/releases are real; no current payment exists. The UI correctly states that balance is shared across the account, a product deviation from the original Workspace-wallet model.

**Visible but unavailable/broken:** purchases are unavailable and all package pointers are NULL; `/tokens` is 404. Sandbox/Live setup are separate missing gates. “View individual operations” routes every non-Video Job to Clipper; the real Script Job produces **404 “Clipper Job not found.”** Statement export is absent. The fiat refund helper cannot pass its own request-path allowlist. Mobile ledger is a horizontally scrollable source component; actual phone usability needs acceptance. Severity **P0** for checkout/policy/reconciliation; links/export **P1**. Matrix S3 and C-12.

### 17. Settings

**Original contract:** Workspace identity/team roles/invitations/removal, isolated encrypted integrations, notification and access settings; Viewer cannot spend or change integrations. Reference page 17; explanation page 8.

**Current:** rename/team/invitation/role/remove/activity controls and server permissions exist. Current role-function reads deny an existing Viewer spend permission with 403 and unrelated membership with 404. Operator pricing is separately allowlisted. The form preserves the last-owner guard.

**Gaps/UX:** no notification preferences were found; real customer integrations are unavailable. Stable invitations are zero and the success message still points to a local development mailbox despite production SMTP. No new actual invitation/remove/reset or full four-role candidate test was submitted. Settings/activity dates use UTC; acceptance should ensure the timezone label remains clear on a phone. Severity **P0** for access acceptance and **P1** for missing controls/copy. Matrix S1-06/07/10/25/26 and C-12/13.

## Desktop/mobile acceptance still required

The source contains sidebar/menu state and responsive single-column rules; historical Workflow/Review/Analytics screenshots cover desktop/mobile light/dark. These establish design implementation, not new device acceptance.

The exact-candidate exit should include: collapse/open/close sidebar and keyboard navigation; visible balance and pending review; Product draft/validation with a phone keyboard; motion/reference comparison; safe status lookup and actionable errors; checkout return and ledger navigation; signed preview/download; and Viewer/read-only/foreign-account behavior. Dense Workflow configuration may prioritize desktop, as the guide permits. Review, status and billing must still work on a phone.

## Visible incomplete controls versus absent functions

| Visible surface | Actual state | Required treatment |
| --- | --- | --- |
| Workflow Start/Resume and new batch launch | Intentionally blocked by rollout/execution/pilot gates | Keep clear unavailable reasons until scoped customer acceptance; do not bypass guards as a UI repair. |
| Review Regenerate | Code/quote/version logic exists; new paid execution closed | Show scope/cost and enable only after accepted bounded admission. |
| Buy Tokens/packages | No active catalog packages; checkout disabled | Complete test and Live prerequisites; do not count a displayed card as a sale. |
| Script/TTS Billing usage links | Wrong destination; deployed read reproduces 404 | Use generic Job detail or correct operation-specific routes. |
| Invitation success | Refers to a local development mailbox | Report actual delivery method/state and test production invitation receipt. |
| Old Product/Content media cards | Some metadata survives but bytes are among 125 confirmed losses | Show accurate unavailable/recovery state; no placeholder pretending to be recovered media. |
| Distribution/scheduling/commerce | TEST evidence only or Not Connected | Retain unavailable labels and keep live sending closed. |

Retention/notification settings and statement export are **missing functions**, not merely disabled visible buttons. The roadmap separates them from the closed but implemented engine.

No page, action, preference, record or feature gate was changed during this parity audit.
