# Stored quotes

POST `/api/workspaces/:workspaceId/billing/quotes` with operation AI_VIDEO or CLIPPER and the usual operation controls. Server validators prepare exactly the frozen execution input without creating a Job. The response includes quote ID/hash, price version, amount, wallet balances, affordability, and expiry.

Default lifetime is 15 minutes; `BILLING_QUOTE_TTL_MINUTES` accepts integers from 10–30. Stored hashes bind workspace, operation, normalized customer input, validated frozen Product/information/rules/reference versions, source storage identity, analyzer/render/provider policy, price version, token amount and expiry. No browser token amount is used.

Submit with quoteId and quoteHash. Changed settings, Product context, references, source, or execution policy require a new quote (409). Expired quotes require a new quote (409). Foreign quotes return 404. A v1 quote remains valid after a v2 price becomes active when its frozen inputs still match; new quotes use v2. A quote is consumed by one JobBilling row.

Idempotent replay of an existing matching Job returns that Job before expiry or current Product checks. A different normalized input with the same request key is 409. Diagnostic and paid job identities cannot be replayed across billing modes.

Forms debounce quote requests, invalidate the displayed quote on input changes, discard stale asynchronous responses, refresh expired quotes, show token price and current funds, and disable submission while unquoted or unaffordable. The server repeats every critical check inside the transaction.
