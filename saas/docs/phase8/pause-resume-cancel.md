# Human controls

OWNER, ADMIN and EDITOR use existing edit/spend permissions to control runs. VIEWER reads only. Human actions emit workflow_events and audit_events under the authorized selected workspace.

Pause changes the Run to PAUSED and blocks new paid children. Already admitted Jobs continue through provider/worker execution, settlement, publication and step observation. A human pause is retained even when all current children finish or review decisions arrive.

Resume allows still-pending identities to schedule. It never recreates completed children or reserves their costs again. Funds waits resume automatically after wallet credit; budget waits can unblock after an increase or released reservation. No entire-run reservation is held through review waits.

Cancel records cancel_requested_at and stops all new admission. The Run displays Cancelling until admitted children are authoritative terminal and their reservations settle. Existing cancelWorkspaceJob immediately cancels safe queued/waiting Jobs and requests cooperative cancellation for running Jobs or uncertain AI provider work. Existing dispatcher/settlement, not workflow logic, performs any release. Successful children stay successful/captured and their Content remains available. Unscheduled operations are marked CANCELLED; review gates are skipped. A finished Run becomes CANCELLED with retained child/content history.

FAIL_FAST uses the same child cancellation contracts for siblings after a definitive failure and marks unscheduled work SKIPPED; it ends FAILED / CHILD_FAILED after admitted children settle. No parent-level financial adjustment is made in either path.
