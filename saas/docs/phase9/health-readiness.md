# Health and readiness

`GET /api/health` is a public process-liveness response containing only status, service name and UTC time. It performs no database, storage or paid-provider request.

`GET /api/readiness` requires an allowlisted operator session or Bearer OPS_READINESS_TOKEN. It checks safe configuration status, PostgreSQL connectivity, all local migration names/checksums and private-bucket reachability. READY returns 200; missing/unavailable dependencies return 503. No provider generation or payment is issued. Restrict this path at the proxy/network as well.

`GET /api/operations` and `/api/operations/metrics` require an active allowlisted operator session. They include execution/Workflow freshness, worker freshness/capability/slots/Clipper health, counters, audit signals and backup metadata. Subservice timestamps distinguish a working process from a failed stage. A fresh healthy instance takes precedence over another instance that has stopped.

Service freshness defaults to 180 seconds, configurable with SERVICE_STALE_SECONDS. STOPPED is OFFLINE immediately; missing records are UNKNOWN; elapsed success is STALE; failed work is ERROR. Worker heartbeats become OFFLINE after 90 seconds. A live web process alone does not certify either dispatcher or the worker.

Customer `/api/workspaces/:id/status` returns only contextual service availability, that workspace's limits and usage after membership/active-workspace checks. It exposes no worker identities, credentials, hostnames or internal topology. The Home page displays a recoverable processing-delay notice.

Tests inject inaccessible storage/DB addresses only into isolated processes. Shared PostgreSQL/storage containers are never stopped to simulate an outage.

WaveSpeed configuration validates exact official API bases and the configured model. Workers report only analyzerConfigured, analyzerProvider and analyzerModel, alongside the existing media health; WaveSpeed jobs can only be claimed by a matching configured worker. Four-field legacy worker health remains compatible with direct OpenAI. Provider readiness/credential checks are distinct from authenticated live preflight and production acceptance. See [WaveSpeed operations](../wavespeed-providers.md).
