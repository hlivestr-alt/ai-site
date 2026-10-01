# Paid-beta gates

Local deterministic acceptance is separate from production/external launch acceptance. Check results in [final report](final-report.md); the external launch verdict remains BLOCKED until the deployment owner records every required real check.

## Deterministic acceptance evidence

| Requirement | Evidence |
| --- | --- |
| Environment modes and production simulation refusal | operational configuration unit tests; dispatcher startup rejection in test:phase9 |
| Health/readiness, DB/storage injection | Phase 9 HTTP/CLI checks, migration checksum validation |
| Execution/Workflow freshness and worker disk/online state | persisted service/subservice ticks; stop/offline/restart tests |
| Safe errors, logging and request IDs | bounded JSON responses, production guards, correlated audit/admission events |
| Auth/sensitive API rate limiting and restart persistence | Phase 9 429/Retry-After/no-mutation/separate-process checks |
| Active Job/Run, queue, upload/day, assets and storage quotas | concurrent Phase 9 low-limit acceptance before Job/reserve/Run/upload mutations |
| Usage/object identity and storage audit | deduplicated DB references, provisional allocations, bounded read-only storage report |
| Coordinated backup and empty-target restore | test:phase9 exported snapshot, pg_dump and all 19 private object checksums |
| Restored finance/history/lineage/media | zero reconciliation mismatches or compensation; sign-in/pages and fresh Product/source/AI/Clipper/poster URLs |
| Backup/destination/corruption failure | missing pg_dump, missing bucket, destination escape, corrupt/incomplete manifest and occupied target rejected |
| Operator isolation and audited actions | Owner/Admin/Editor/Viewer denied; explicit allowlisted operator succeeds with reason/audit |
| Neutral SMTP abstraction and local retry | encrypted delivery state, deterministic mail failure then successful retry; zero real sends |
| Cookies/origin/body limits/security headers | baseline auth/isolation and Phase 9 origin/oversize/CSP/private-media checks |
| Read-only accounting/Job/Workflow/Content audit | bounded issue counts/examples; no age-based force failure or ledger rewrite |
| Query/index/capacity review | ten read-only EXPLAIN ANALYZE queries and moderate reused TEST dataset; configurable bounded batches/capacities |
| Earlier phases and restart behavior | full integration/browser suite, worker tests, existing restart/Clipper recovery acceptances |
| Migration safety and release checks | clean 0001–0009 bootstrap, 0008→0009 upgrade/checksums, lint/typecheck/build |
| Scope/safety | SaaS-only changes; no native systems, production money, real provider calls or Phase 10 features |

## Production/external launch checklist

- [ ] Final independent SaaS domain, HTTPS and trusted proxy/callback behavior accepted.
- [ ] Separate production DB/bucket/environment/secrets; no local fixture data or fake/test flags.
- [ ] Active allowlisted operator account and restricted readiness/metrics access tested.
- [ ] Supervised web, execution dispatcher, Workflow dispatcher and private outbound worker; upgrade/drain/restart/rotation proved.
- [ ] Worker CLIPPER_V1 concurrency 1, installed model/CUDA/FFmpeg, disk prechecks and terminal cleanup stable.
- [ ] Production SMTP delivered controlled verification/reset/invite mail with correct-domain links; retries/operators tested.
- [ ] Production bucket private; unsigned/foreign access denied; signed PUT/GET/expiry, browser CORS, multipart/resume/copy/range verified.
- [ ] Provider-specific >5 GiB handling proved before raising the source-size cap; safe lifecycle/encryption/versioning/physical-capacity alerts reviewed.
- [ ] AI_VIDEO QUALITY and CLIPPER PRODUCTION price versions plus an active deliberate package and Workflow ceiling configured.
- [ ] Exactly one intentional real BytePlus acceptance passed with one Job/reservation/task/result and private Content.
- [ ] Exactly one intentional short real OpenAI Clipper flow passed, with model/request count/usage recorded safely.
- [ ] Exactly one Xendit sandbox purchase passed with authenticated callback/query, one PURCHASE and wallet credit; no live charge.
- [ ] Financial, lease, publication, Content lineage and Workflow audits clean/actionable; unknown outcomes investigated without blind retry.
- [ ] Protected current coordinated backup and recent isolated restore drill; secret recovery/retention/cutover plan accepted.
- [ ] Feature switches and conservative workspace/provider capacities reviewed for the small beta cohort.
- [ ] production-preflight returns ready=true after real evidence/attestations; no attestation copied from deterministic fixtures.

No service installation, DNS/TLS change, production storage lifecycle rule, live payment capability or external acceptance is executed by this phase. Outreach, Distribution, creator matching, social publishing, subscriptions, GMV/ROI, advanced analytics, free-form Workflows and automatic AI Video→Clipper chaining remain out of scope.
