# Platform support

`/operations` is a separate restricted page. Only active accounts explicitly listed in PLATFORM_OPERATOR_USER_IDS/EMAILS can access it or its APIs. Workspace Owner/Admin/Editor/Viewer grants do not imply platform authority. Customer-facing navigation does not advertise this route. CLI read-only tools require host/environment access; CLI mutations additionally require OPERATOR_USER_ID to identify an active allowlisted actor.

Investigation uses UUID, exact workspace-name and email lookup, bounded workspace/user/Job/Run/Payment/Content/worker details and read-only audits. Workspace detail includes memberships, wallet/ledger-derived balances and reservations, recent work, limits and usage. Job detail includes attempts, leases, safe events, provider state and publication. Run detail includes steps, children, billing totals and exact review bindings. Payment detail contains safe provider identity/package/events/issues, not checkout secrets/raw payloads. Content detail exposes immutable version lineage/review IDs. Histories are bounded to 100 examples; inspect exact IDs for older entries.

The operator form and `operations.ts action <file.json>` accept explicit reasoned recovery actions. The CLI also accepts RECORD_RESTORE_VERIFICATION for completed drill receipts as documented in [backup and restore](backup-and-restore.md):

| Action | Existing authority |
|---|---|
| SET_QUOTA | Serialized workspace limit update |
| SETTLE_JOB | Definite terminal state plus existing ledger constraints |
| RECONCILE_PAYMENT | Authenticated query for its existing external payment |
| RETRY_PUBLICATION | Existing publication intent and sealed successful result |
| RETRY_POSTER | Failed derivative only; media/history retained |
| WAKE_WORKFLOW | Existing nonterminal Run due time; pause/review/budget rules still apply |
| RETRY_MAIL | Failed delivery only; verification/activation rules retained |

Every requested action, completion/failure and quota change records actor, workspace, target, reason and request correlation. Unsupported actions are rejected. These tools cannot force Job success, force paid status, approve Content, alter immutable inputs/history or directly change a wallet. Previous billing catalog/refund CLI paths now require an allowlisted production actor; explicitly isolated local TEST accounting fixtures retain their guarded test-only funding path.

For uncertain provider submission, preserve Job/ProviderExecution/reservation and inspect correlation/external identity. For uncertain Payment creation, preserve its Payment row and never create a replacement blindly. For stale worker leases, allow fenced reconciliation/retry. For funds/review waits, direct the customer to Billing/review; support wake is not approval or additional budget. Investigate storage/lineage failures before publication retry. Escalate unresolved accounting findings with IDs and safe codes, never customer secrets.
