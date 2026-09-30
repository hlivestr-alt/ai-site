# OpenAI production analyzer

Implementation uses POST https://api.openai.com/v1/responses with text.format {type:json_schema,name:clip_candidates,strict:true,schema:...}, store:false, max_output_tokens 4000. This follows the official [Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs), fetched September 30, 2026. Response status, refusal/incomplete cases, model output and local bounds are checked independently.

Configure the worker-local OPENAI_API_KEY and explicitly choose OPENAI_CLIP_MODEL with structured-output support. No model identifier is guessed or silently substituted. CLIP_ANALYZER_PROVIDER=openai is required. Policy v1 is generic; source transcript/goal/Product text are treated as untrusted content. Candidate schema is strict, absolute timestamps are required, and raw request/response/provider dumps are never customer artifacts. Usage stores bounded input/output tokens, request count and model identifier in the private plan.

The worker calls the provider directly using its own operational secret; SaaS snapshots, heartbeat, customer UI and logs never carry that key. Production rotation should update the worker service secret, drain/restart safely and revoke the previous provider key. Future central credential ownership can preserve this analyzer interface while adding server dispatch; do not proxy source video.

No OpenAI credential was present in the inspected SaaS/process configuration. REAL OPENAI ANALYZER TEST BLOCKED — OPENAI API KEY REQUIRED. No paid analysis was triggered.
