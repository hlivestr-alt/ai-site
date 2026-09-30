# Phase 4: AI Video Jobs

This phase adds customer AI Video generation to the existing SaaS Job platform. The customer selects one ACTIVE Product, enters a prompt, chooses Quality, a supported duration and ratio, and requests one MP4. The durable Job, outbox, provider execution, and private artifact survive a closed browser.

The current server policy maps Quality to BytePlus ModelArk Dreamina Seedance 2.5. FAST and PREMIUM are not offered. With no BytePlus API key configured, normal customer generation is unavailable. The deterministic fake provider is enabled only by explicit local test configuration and is labeled as a simulation in the UI.

Read [AI Video Jobs](ai-video-jobs.md), [provider interface](video-provider-interface.md), [BytePlus](byteplus-seedance.md), [reconciliation](provider-reconciliation.md), [artifacts](video-artifacts.md), [failures](failure-and-retry.md), and [local development](local-development.md). [Phase 5 handoff](phase5-handoff.md) identifies reusable worker contracts without implementing Clipper.

Migration `0004_ai_video_provider.sql` applies after Phase 3. It preserves existing SYSTEM_TEST Jobs, adds immutable client request hashes, provider policy and execution records, and raises only MP4 Job artifact capacity to 512 MiB at the database boundary. Runtime output defaults to 256 MiB. No Token, payment, Clipper, Workflow, or Content Library schema is added.
