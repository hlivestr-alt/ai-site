# Workflow token ceiling

max_tokens is a hard admission ceiling, not a wallet reservation. The parent has no JobBilling and creates no paid ledger entry. Only admitted children reserve, capture or release through Phase 7. Review, pause, resume, estimates and reconciliation replay are free.

Committed = sum of RESERVED + CAPTURED child JobBilling amounts. REFUNDED remains included in historical captured/committed consumption in v1 because there is no paid rerun policy. RELEASED frees workflow capacity. Captured includes historical generation charges even if later refunded; the separate refunded total records that fact. Remaining = max_tokens − committed. Reserved, captured, released and refunded summaries derive from authoritative JobBilling; tokens_committed is a refreshed display projection, not an independent ledger.

Every admission holds the Run lock, observes committed child billing, gets a valid server quote, verifies committed + quote <= ceiling and invokes existing wallet-locked paid admission. That service separately requires available wallet balance >= quote. Neither balance can overrun; wallet triggers retain their nonnegative constraints. Authoritative Jobs are included even if a child mapping needs recovery.

Wallet shortage sets WAITING_FOR_FUNDS / INSUFFICIENT_FUNDS; fresh wallet credits automatically unblock later ticks. Workflow shortage sets PAUSED / BUDGET_EXCEEDED. Released child amounts or an authorized budget increase may unblock the latter. Human pause remains paused independently of financial state.

Budget increases require spend permission, an integer decimal string within WORKFLOW_MAX_TOKENS, and an amount strictly greater than the current ceiling. Decreases are rejected, including any below committed. Event and AuditEvent record the increase. Initial ceiling remains in the immutable input snapshot; current max_tokens stores the approved increase. New children freeze active pricing independently; existing JobBilling never changes price.

Production has no implicit workflow ceiling: configure WORKFLOW_MAX_TOKENS deliberately before enabling definitions/runs. Local default is 100000. No production price catalog or package is seeded by this phase.
