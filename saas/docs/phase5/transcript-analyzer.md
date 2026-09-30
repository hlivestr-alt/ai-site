# TranscriptAnalyzer

Provider-neutral Protocol: analyze({transcriptVersion,language,productSnapshot,goal,policyVersion,minClipSeconds,maxClipSeconds,chunk}) → {candidates,usage,modelVersion}. Pipeline handles chunking, validation, global ranking and rendering independently of provider.

FakeTranscriptAnalyzer deterministically selects bounded moments from timestamped chunk speech and labels modelVersion fake-transcript-v1. It uses the same validators/selector/render path. It is enabled only by explicit worker configuration CLIP_ANALYZER_PROVIDER=fake and ENABLE_FAKE_CLIP_ANALYZER=1, and requires a test-capability job. Automated tests never need a paid provider.

Production provider is OpenAI with an explicit worker-local secret. There is no LM Studio fallback or native brand prompt. Rate limit, timeout and server failure have bounded retries (three per chunk); refusals/incomplete/malformed/fully-invalid candidates fail safely. Empty/insufficient selection never fabricates clips. Successfully analyzed chunks are keyed and stored locally to avoid repeated calls after a later chunk fails. Durable plan checkpoints avoid analysis after worker recovery. A lost worker before a chunk/plan checkpoint can require reanalysis; exactly-once paid provider billing is not claimed.
