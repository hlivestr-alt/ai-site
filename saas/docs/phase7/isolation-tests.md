# Isolation and accounting tests

Playwright uses TEST_DATABASE_URL, TEST_OBJECT_STORAGE_BUCKET and installed Chrome. Test setup explicitly migrates/seeds the TEST catalog. Existing Phase 1–6 fixtures now explicitly grant their test wallets and submit through real quotes; no customer fake-provider exemption was introduced.

Billing integration covers zero wallets; payment replay; ten concurrent paid callbacks; invalid authenticity; wrong amount/currency; unknown payment; lost callbacks; purchase rollback; wallet/ledger immutability; version changes; expiry; stale Product context; insufficient funds; two-device overspend; ten matching job replays; job/reservation rollback; paid success/failure/retry/unknown submission; duplicate capture/release; token refunds; late-success quarantine; Clipper reservation/cancellation; and Viewer/Editor/Admin plus Brand A/B isolation.

Chrome acceptance buys a TEST package, submits a quoted normal fake AI Video, observes reserved funds, closes and reopens, observes capture and separate Content, executes a paid failing fixture, and verifies release and access denial. `test:billing-restart` restarts actual app and dispatcher/payment-reconciliation processes while payment, reserved job and running job state remain durable.

Unit tests verify bigint arithmetic, normalized hashes, roles, and explicit fake provider/authenticity gates. Migration bootstrap verifies all seven migrations. Old worker tests and artifact fixtures run without any new Whisper/GPU transcription or external AI calls.
