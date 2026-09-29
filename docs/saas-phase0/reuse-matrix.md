# Reuse decisions (future only; nothing changed in Phase 0)

| Current component | Decision | Rationale / migration boundary |
| --- | --- | --- |
| AI Site shell, navigation, status cards, theme | **Refactor later** | Visual starting point, but customer navigation, auth and data contracts differ |
| AI Videos page/forms/history UI | **Wrap / refactor later** | Useful upload/progress/preview patterns; needs saved product, tier, quote, workspace job and library |
| H3 bridge idempotent intent, state/history, artifact checks | **Extract** | Excellent design patterns; JSON/local disk/one GPU are not SaaS authority |
| H3 bridge runtime as paid provider | **Retire from customer path** | Retain internal/test usage; no tenant/storage/billing scaling assumption |
| Clipper transcript store and Faster-Whisper/WhisperX | **Extract** | Versioned transcript and word timing useful in isolated worker; avoid sharing current native cache |
| Clipper LM Studio moment prompt/scoring | **Replace** | Current prompt and product logic are PROYA-specific; build provider-neutral analyzer and global ranker |
| Clipper FFmpeg/caption/validation pipeline | **Wrap / extract** | Reuse proven local rendering under explicit job input/output contract and per-job directory |
| Clipper desktop FastAPI/control token | **Retire from SaaS job path** | Native operator remains untouched; not a public tenant API or durable cloud lease |
| Clipper queue JSON/SQLite and history | **Retire as SaaS authority** | Keep native history for existing work; new Postgres Job/Content rows own customer work |
| Current Outreach API adapter, preview/freeze/confirm logic | **Refactor later** | Reuse patterns only after workspace account authorization; keep current internal sender separate |
| Outreach shared sender/DB/Redis/workers | **Do not reuse for customer send** | Native state/account and customer boundaries differ; late phase migration or new integration |
| AI Site audit JSONL / operation journal | **Replace as authority; reuse event vocabulary** | Customer audit and idempotency require durable workspace DB records |
| `start-platform.ps1` and local Cloudflare route | **Reuse as-is for internal runtime only** | Do not couple production cloud deployment to local Windows startup/tunnel |
| Creative Studio and ComfyUI | **Leave untouched** | Existing internal production and H3 test resources; future cloud provider adapter independent |
| n8n | **No first-release dependency** | No validated job/ledger ownership or need; optional later workflow integration |

Existing databases remain owned by their native apps. The new SaaS Postgres is the sole authority for customers, jobs, products, content, wallets and payments. Historical bridges/imports, if ever needed, require explicit migration plans rather than direct cross-DB joins.
