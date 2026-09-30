# Acceptance and isolation tests

Tests run with explicit fake provider/analyzer enablement and the isolated test database/bucket. Chrome is the installed real browser (`channel: chrome`). Clipper content acceptance publishes the existing prebuilt MP4 fixture through authenticated lease/fencing/output/finalize/complete callbacks, with deterministic transcript/plan fixtures. It does not launch Whisper, OpenAI analysis or a new clip render.

`tests/integration/content.spec.ts` covers:

- AI Video: one READY result → one item/version; ten concurrent publication calls; one provider submission.
- Historical hard gate: hold publication after success, update Product v1→v2 and replace its image, then publish and verify exact v1 text/reference bytes in API and Chrome. The replacement reference ID returns 404.
- Clipper: two MP4 items and no transcript/plan items; same source ID/SHA/support artifacts and correct selected spans; ten concurrent publication calls.
- Chrome preview, Approve, BAD_CLIP_SELECTION Reject with reason, persistent history, downloads/checksum, Library and empty Review Center.
- Workspace A counts of three Content assets, two Approved and one Rejected before later concurrency/archive checks; empty B counts. List/type/status/Product/search filters and page bounds.
- B requests substituting A workspace/item/version IDs across detail/history/preview/download/poster/source/reference/review/archive/relations are denied. A child with a real B parent is rejected by API and database.
- Viewer may read/download under the selected matrix; review/archive/relation writes return 403 and Chrome mutation controls are absent.
- Identical review concurrency gives one append; conflicting same-revision decisions give one 200 and one 409. Later re-review preserves earlier decisions.
- Variant chain, self/cycle rejection and foreign current-version pointers; append-only history, immutable checksum and artifact/source retention.
- FAILED/CANCELLED/RECONCILING jobs create no intents or items. PENDING and READY/LOST extras cannot enter versions or publication; wrong checksum/workspace lineage is rejected.
- Approved v1 → trusted v2 insertion/current-pointer change → Pending Review, old history preserved, stale-version review rejected and eligibility false until v2 gets its own approval. Archive disables eligibility/download while retaining preview.
- Poster failure remains independent; retry yields READY and unsigned poster access fails.

`npm run test:content-restart` requires the successful Chrome acceptance fixture. It injects a scoped database publication failure, restarts its owned app and dispatcher processes and verifies exactly one recovered item/version, ten replay calls and the same successful job/artifact/execution with one submission. Other Phase 3/4 restart tests remain available. All owned helper processes stop in test cleanup; temporary failure triggers are removed.

Validation commands: `npm run test:unit`, `npm run test:browser`, `npm run test:schema-bootstrap`, `npm run test:restart`, `npm run test:video-restart`, `npm run test:content-restart`, `npm run lint`, `npm run typecheck`, `npm run build`; unchanged worker regression uses `python -m unittest discover -s tests -v` from `worker-agent`. Do not run a fresh real Clipper acceptance job for Phase 6. Evidence JSON, logs and screenshots stay in ignored `saas/data/phase6`, with final measured results in the [report](final-report.md).
