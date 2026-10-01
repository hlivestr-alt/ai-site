# Process supervision

Run the Next web app, execution dispatcher, Workflow dispatcher and private Python worker as independent supervised processes. Execution subservices include lease/outbox recovery, provider reservation/actions, token settlement, payment reconciliation, Content publication, posters and mail. A failing subservice reports ERROR while other stages continue.

For Linux, review the systemd templates under `deploy/systemd/`, adjust executable/workspace/environment paths and install them during a separately authorized deployment. They use a dedicated account, automatic restart, private temporary directories and journald. This implementation installs no services or startup tasks.

For Windows, use a service wrapper with a dedicated service account and a protected environment file. Configure restart with backoff, hidden execution, working directories, bounded log rotation and a drain interval. Use the direct Node command rather than an npm wrapper, so stop signals reach the supervised process. The private worker command is `python worker_agent.py` from `worker-agent`; use its existing private environment and outbound HTTPS API access. No listening port is required on that machine.

Startup order: PostgreSQL/storage, migrations, web/readiness, execution dispatcher, Workflow dispatcher, private worker. Confirm RUNNING heartbeats and worker capability/health before enabling paid admission.

SIGINT/SIGTERM stops new dispatcher claims between items. Current transactions/actions finish; idle polling wakes immediately; STOPPED is persisted and the pool closes. The process tests exercise the same drain handler through a local IPC stop message because Windows process termination does not provide Unix signal semantics. Forced termination is recovered through the existing outbox, due timestamps, leases and fencing. Never force success after a crash.

Default polling is 1 second, bounded 200–30000 ms. Default execution batches are 25 reconciliation/dispatch/settlement, 10 provider reservations/payments/publications, 20 provider actions, 2 posters and 5 mail deliveries; each is configurable with BATCH_<UPPERCASE_STAGE_NAME>, maximum 100. Default provider concurrency is 10 globally and 3 per workspace. Clipper remains one active Job per worker. Review capacities with measured throughput before raising them.
