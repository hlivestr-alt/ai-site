# Failure and retry rules

Customer input and capability failures are rejected before Job creation. A provider rejection before task creation fails the Job; an explicit rate limit before task creation schedules a delayed new attempt. Once an external task may exist, the system does not automatically submit another generation. An accepted provider task that reports failed becomes a failed Job. Polling/network status failures retry polling of the same external ID.

An HTTP create timeout, 5xx, or successful response without an ID is uncertain. The Job enters RECONCILING and holds the same ProviderExecution; the BytePlus adapter does not make a second POST. The fake provider's lookup recovers its accepted task for acceptance testing. An unknown real task needs account-side or support reconciliation.

A temporary result download/storage failure retries ingestion of the same task up to six times. Invalid MIME, MP4 container, declared length, or checksum fails as `OUTPUT_INVALID`. Safe categories include `INVALID_INPUT`, `PROVIDER_RATE_LIMIT`, `PROVIDER_REJECTED`, `PROVIDER_UNAVAILABLE`, `PROVIDER_TIMEOUT`, `PROVIDER_FAILED`, `OUTPUT_UNAVAILABLE`, `OUTPUT_INVALID`, and `INTERNAL_ERROR`. Customer endpoints show bounded safe text; raw provider response bodies, authorization headers, and private costs are not recorded in Job events.
