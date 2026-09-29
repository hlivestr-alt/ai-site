# Job and attempt states

| Job state | Meaning |
| --- | --- |
| `QUEUED` | Transactionally created; outbox pending, including retry backoff. |
| `WAITING_FOR_WORKER` | Dispatcher validated input and made the Job claimable. |
| `RUNNING` | An authenticated worker has an active lease. |
| `RECONCILING` | A future non-fixture operation had uncertain outcome and needs a type-specific decision. |
| `SUCCEEDED` | Verified current lease completed. Terminal. |
| `FAILED` | Input unavailable, definitive failure, or attempts exhausted. Terminal. |
| `CANCELLED` | Cancelled before claim or cooperatively by a running worker. Terminal. |

Attempt states are `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `LOST`, and `CANCELLED`. The current attempt number is stored in `jobs.attempt_count` only when claimed. Retry creates a new pending attempt and outbox row; history is retained. Progress is 0–99 while running and 100 only after successful completion. Sequence numbers deduplicate repeated progress callbacks and percent cannot decrease within an attempt.
