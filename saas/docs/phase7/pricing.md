# Versioned token pricing

Catalog identities are AI_VIDEO or CLIPPER with TEST or PRODUCTION realm. Immutable version rows contain integer rule strings. A catalog's active-version pointer changes separately. Existing quote and JobBilling rows retain their original version forever.

TEST v1 deliberately uses synthetic prices: AI Video QUALITY = 140 tokens per second, quantity one; Clipper = 400 base + 100 per requested clip + 100 with captions. Thus a five-second video or two-captioned-clip request costs 700 TEST tokens. Clipper uses the requested maximum clip count, not uncertain source duration or the number of moments eventually found. It quotes a fixed maximum charge before execution and charges once per parent Job.

Explicit local seeding adds a TEST-only package of 10,000 tokens for 10,000 IDR minor units. These are fixtures, not commercial prices. Production catalogs/packages are not seeded or activated by Phase 7. Missing production pricing fails submission safely.

An operator can configure supplied authoritative prices using `node --env-file=.env.local --import tsx scripts/billing-catalog.ts config.json operatorUserId "reason" stableKey`, with the support CLI flag. Config has `realm`, `prices` (operation, version, label, rules), and `packages` (code, version, label, tokenAmount, fiatMinor, currency). Use new version numbers for changes. This command validates integer strings, locks catalog identities, rejects differing immutable versions, activates pointers, and audits the supplied configuration hash. It does not supply commercial values.
