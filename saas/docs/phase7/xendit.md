# Xendit sandbox adapter

Official documentation checked 2026-09-30. The adapter uses Payment Sessions PAY / PAYMENT_LINK with AUTOMATIC capture, appropriate to one-time top-ups. See [Sessions overview](https://docs.xendit.co/docs/payment-sessions-overview) and [one-time payments](https://docs.xendit.co/docs/payment-1).

[Create Session](https://docs.xendit.co/apidocs/create-session) documents POST /sessions with HTTP Basic authentication, merchant reference, customer, amount/currency, hosted link and HTTPS return URLs. It does not document a create idempotency header or a reference-list lookup. We therefore persist one creation attempt and hold ambiguous outcomes rather than assume a retry is safe. Expiry is 30 minutes here; the documented create minimum is ten minutes into the future.

[Get Session](https://docs.xendit.co/apidocs/get-session) supports authenticated GET /sessions/:id for known external identities. ACTIVE maps to PENDING, COMPLETED to PAID, EXPIRED to EXPIRED and CANCELED to FAILED. A failed payment attempt does not itself mean a whole session failed. Status is always tied to the stored merchant reference, amount/currency and external identity.

[Session callbacks](https://docs.xendit.co/apidocs/webhook-notification-sent-defined-webhook-url-updates-payment-session) supply payment_session.completed/payment_session.expired, business identity and session/payment identities. We derive stable event identity from session ID, normalized outcome and payment ID. Delivery timestamp is excluded from hashing. [Webhook handling](https://docs.xendit.co/docs/handling-webhooks) documents x-callback-token verification and duplicate/unordered delivery. This adapter compares the configured token in constant time before parsing and validates the configured business identity. It does not invent an HMAC for Xendit. Fake callbacks use a separate HMAC.

[API keys](https://docs.xendit.co/docs/api-keys) distinguish test and live credentials. This implementation additionally enforces XENDIT_MODE=test and, as a conservative implementation policy, a development-key prefix. It accepts only dev.xen.to hosted sandbox checkout URLs. Configuration: XENDIT_SECRET_KEY, XENDIT_CALLBACK_TOKEN, XENDIT_BUSINESS_ID, and XENDIT_RETURN_BASE_URL (HTTPS). Secret values never enter the database, browser or logs. Requests use https://api.xendit.co with a bounded timeout. Unknown test key/link formats require verification before changing the guard.

Amounts in our database are integer fiat minor units. Phase 7's real adapter deliberately supports IDR only, whose minor exponent is zero, so integer amount serialization is exact. Other package currencies are not sent through this adapter. No fractional-money conversion is implemented or guessed.

[Refund request](https://docs.xendit.co/apidocs/refund-payment-request) documents POST /refunds with original payment_request_id, reference, reason, and optional amount/currency. The optional adapter method supports that sandbox transport. [Refund callbacks](https://docs.xendit.co/apidocs/refund-webhook-notification) identify the original request and refund outcome. Authenticated refund events resolve the original payment through its stored confirmed event identity, retain an issue for support, and never claw back tokens. A full confirmed fiat refund can mark the payment REFUNDED; partial refunds remain support records. No customer fiat-refund endpoint or automatic fiat-refund retry is enabled; channel eligibility is provider dependent.

Current environment: no Xendit sandbox secret/callback credential. Real sandbox creates/payments attempted: 0. Adapter transport/lifecycle tests use mocked official-shaped responses, not a real sandbox claim.

REAL XENDIT SANDBOX ACCEPTANCE BLOCKED — XENDIT SANDBOX CREDENTIAL REQUIRED

When credentials are supplied, first keep the fake acceptance passing, configure a controlled IDR TEST package and public sandbox webhook/HTTPS return URLs, then perform exactly one sandbox top-up and verify callback/query convergence and one purchase credit. Production payment calls are outside Phase 7.
