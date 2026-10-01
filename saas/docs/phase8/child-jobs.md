# Existing child Jobs

AI Video and Clipper HTTP wrappers and workflow admission share paid-operations.ts. Video validation, reference selection, Product accuracy instructions and provider policy validation are extracted to video-operation.ts. Clipper preparation is shared through clipper-operation.ts and its existing request validator. Provider routing, Job/attempt/outbox insertion, wallet reservation, execution, settlement and publication remain the existing services.

Each intended child key is deterministic (video:01:01, video:01:02, clipper:01). Idempotency is workflow:<run-id>:<child-key>, backed by existing workspace/type/key uniqueness and one workflow Job per step. A child gets one Quote, JobBilling and reservation; Job retries retain these financial identities. A 402 creates no Job/attempt/outbox for that intended child. Previously admitted children are never repriced.

Quotes are obtained from createQuote, not workflow price arithmetic. An unadmitted child's pending quote can be reused while valid and still on the active PriceVersion. Expired or superseded quotes refresh before admission. Estimates use current server quotes but make no reservation and do not freeze prices for future children.

Definitive FAILED/CANCELLED children derive their step outcome from Job. Existing settlement releases only when uncertainty has resolved. RECONCILING retains the same child and reservation. CONTINUE_PARTIAL reviews successful siblings and fails with NO_USABLE_CONTENT if none remain. FAIL_FAST stops further admission and requests existing child cancellation before terminal failure; already successful captures remain intact.

Workflow → Job → Content publication integrates through immutable lineage, including Product, source, provider and worker artifacts already recorded by those systems. Workflow never fabricates output or calls a second provider implementation.
