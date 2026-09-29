# Phase 1 ready checklist and decisions

Decisions below are planning recommendations, subject to staging proof and commercial onboarding. They do not authorize starting Phase 1.

| Question | Phase 0 answer |
| --- | --- |
| 1. Keep? | AI Site shell/forms/status patterns; H3 idempotency/artifact patterns; Clipper transcription/rendering primitives; Outreach preview/freeze/confirm pattern for much later |
| 2. Wrap? | Current video UI behind new Job/VideoProvider; Clipper headless pipeline behind outbound private worker; native systems stay separate |
| 3. Replace? | Single-operator auth for customers, bridge JSON/native DB as customer authority, desktop Clipper control API as customer job API, PROYA-specific moment prompt, file journals as customer ledger, shared Outreach sender |
| 4. SaaS source of truth? | **New managed Postgres**, separate from Outreach Postgres and Clipper SQLite |
| 5. Object store? | Private **Cloudflare R2** through S3-compatible interface; validate residency/contract, retain S3 alternative |
| 6. Queue? | Postgres transaction + durable outbox + `SKIP LOCKED` dispatcher and lease/reconciler; Redis optional later |
| 7. Windows worker communication? | Worker-initiated TLS register/heartbeat/claim/renew/progress/complete/fail, fenced lease, signed scoped object URLs; no customer connection to PC |
| 8. Video abstraction? | `VideoProvider` capabilities/quote/submit/poll/cancel?/retrieve/error/progress with internal Fast/Quality/Premium routing |
| 9. First provider? | Official Seedance 2.x/2.5 **candidate** for P4 bake-off; select exact model only after account/API region, rights, reference fidelity, reliability and cost proof. H3 is internal fallback/test only. |
| 10. Auth/workspaces? | Managed customer identity plus Postgres WorkspaceMember roles and server/media authorization; no `AUTH_ENABLED=false` in customer environment |
| 11. Token schema? | Workspace Wallet plus append-only dual-delta ledger, price version pinned, transactional reserve/capture/release and unique idempotency |
| 12. Payment target? | Xendit sandbox first, with Midtrans as substitute pending merchant/terms review; Stripe Indonesia constraints make it unsuitable as first assumed card gateway |
| 13. P1–2 screens? | Home onboarding, Settings membership, Products list, Add Product Basic/Assets/Rules, Product Detail |
| 14. Hidden until later? | Paid Create Video/Clipper/Workflow/Review/Library/Billing until real vertical paths; Distribution and unverified sales analytics through P10 |
| 15. Untouched systems? | H3 bridge, Creative Studio, ComfyUI, native Clipper/queues/DB, Outreach/API/DB/sender/crawler, n8n, Cloudflare, production env and tasks |
| 16. Top ten risks? | See ranked list in [security](security-and-isolation.md): public no-login route, tenant IDOR, media leak, ledger race, payment replay, provider ambiguity, lease staleness, Clipper shared state, shared Outreach sender, missing support recovery |
| 17. Phase 1 sequence? | (a) Isolated staging environment/new DB and migration tool; (b) identity/session + signup/recovery; (c) Workspace/Member schema and invitations; (d) common workspace authorization query helpers and role matrix; (e) server API and media-denial harness; (f) onboarding/Home/Settings; (g) Brand A/B cross-tenant and role tests; (h) backup/audit and operator review. |

## Phase 1 acceptance before proceeding to Products

- Brand A and Brand B can register/create workspaces; invites and recovery work; removed member access ends.
- Owner/Admin/Editor/Viewer server matrix is enforced even with hand-written HTTP requests; Viewer cannot spend or change integrations.
- Workspace A cannot fetch or mutate B's known object ID; signed media prototype enforces same boundary; audit actor/workspace is correct.
- Customer staging is separate from the current 3100 internal runtime and its unauthenticated Outreach gate. No native database or service was changed.
- New Postgres backups and schema migration rollback procedure are demonstrated. Internal provider cost and secrets never appear in customer responses.

Stop after Phase 0. Phase 1 is the next implementation request, not part of this deliverable.
