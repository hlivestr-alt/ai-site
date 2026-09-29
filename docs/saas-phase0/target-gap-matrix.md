# Target 17-screen gap matrix

`Backend/model` indicates current **customer SaaS** capability; native/internal equivalents are noted separately. `P1–P10` refer to [implementation phases](implementation-phases.md). Sample brands, prices, balances, creators, GMV and ROI in the mockups are not requirements or real data.

| Target screen | Current equivalent | Backend? / data model? | Reusable UI / service? | Major gap | Phase |
| --- | --- | --- | --- | --- | --- |
| 01 Home | `/` tool dashboard | Partial internal / no tenant model | Cards / bridge summaries | Workspace onboarding, wallet, approvals, actionable counts | P1, P6–8 |
| 02 Products | None | No / no | Shell / no | Searchable workspace products | P2 |
| 03 Add Product Basic | None | No / no | Forms / no | Draft, SKU, brand/benefits/audience | P2 |
| 04 Add Product Assets | AI Video temporary references | No / no | Upload control / validation pattern | Persistent private images/real footage, rights, versions | P2 |
| 05 Product Rules | None | No / no | Forms / no | Versioned accuracy constraints | P2 |
| 06 Product Detail | None | No / no | Cards / no | Reuse, versions, related runs | P2 |
| 07 Create Video | `/ai-videos` | Internal bridge / bridge JSON only | Strong form/status / H3 patterns | Product/tier/quote/persistent job/provider storage | P3–4, P7 |
| 08 Clipper | `/clipper` read-only + local link | Native API partial / native stores only | Status lists / extraction candidates | Upload, worker lease, real job/output to library | P3, P5, P7 |
| 09 Workflows | None | No / no | Shell / no | Persisted run list/counts | P8 |
| 10 Create Workflow | None | No / no | Forms / no | Controlled template, product/price snapshot, budget | P8 |
| 11 Workflow Run | None | No / no | Status badges / job pattern | Child jobs, pause/resume/retry/review | P8 |
| 12 Review Center | None | No / no | Video preview / no | Reference comparison, decisions, block rejected | P6 |
| 13 Content Library | Bridge-only history | No / no | History/preview / artifact pattern | Workspace lineage, search, protected download | P6 |
| 14 Distribution | `/outreach` internal | Internal only / native Outreach | Some workflow UI / preview-freeze-confirm pattern | Per-customer authorized channels and own sender | P10, hidden until ready |
| 15 Analytics | Home internal counts | Partial operational / no tenant model | Cards / summary logic | Reconciled workspace job/token metrics; channel metrics later | P9–10 |
| 16 Billing & Tokens | None | No / no | Shell / no | Ledger, quote, sandbox payment, statement | P7 |
| 17 Settings | `/settings`, `/login` | Operator only / no members | Theme/status / auth primitives | Workspace/team roles/integrations/access log | P1, P9 |

Customer-facing route visibility should follow genuine backend gates. P1–2 show onboarding, workspace settings, Products wizard/detail. Create Video, Clipper, Workflow, Review, Library and Billing appear only as each real vertical path becomes operational in staging. Distribution and sales analytics stay hidden/Not connected until P10. No fake data should be inserted to satisfy mockup appearance.
