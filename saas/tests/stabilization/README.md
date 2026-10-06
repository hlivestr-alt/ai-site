# Stabilization Phase A verification

Run from `C:\Data\ai-site\saas`:

```powershell
node tests/stabilization/run.mjs --suite integration
node tests/stabilization/run.mjs --suite browser
node tests/stabilization/run.mjs --suite focused
node tests/stabilization/run.mjs --suite restart
node tests/stabilization/run.mjs --suite restart-bounds
```

Each run creates a uniquely named database, private bucket, and gateway on loopback port 9027. The application runs on 3227 with fake providers and disabled real inference credentials. Run these suites sequentially because they share those two ports. The runner removes only the resources it created and records cleanup in `docs/stabilization-phase-a-evidence`. It never writes the original master acceptance report or evidence.

`focused` covers media rejection before reservation, signature forgery and workspace boundaries, failed-upload retention, safe worker diagnostics including historical rows, and Chrome/real Edge navigation, playback, downloads, console and secret checks. It also verifies lock contention, failure release, a four-finalization bound, and a query pool configured with one connection. Tests call the same protected version-specific media endpoints used by the application.

`restart` launches `python worker_agent.py`, hard-stops its owned process at six stages, expires only its owned lease, and launches the same command again. `tests/phase_a_fixtures/sitecustomize.py` is an opt-in test adapter, loaded only through the test process's `PYTHONPATH`. It substitutes transcription and pauses at controlled boundaries; the production pipeline handles actual transfers, FFmpeg rendering, checkpoint validation, fencing, upload finalization, completion and publication. Result upload is interrupted after PUT and before finalize. The bounds case sends normal heartbeats between lost leases, as a restarted worker does. No application or deployed worker imports the adapter.

For the explicitly configured remote test deployment only:

```powershell
node --import tsx tests/stabilization/reference-proof.ts
node --import tsx tests/stabilization/remote-checks.ts
node tests/stabilization/remote-html-diagnostic.mjs
```

The reference proof creates and deletes its own private object/bucket and exercises the real WaveSpeed reference URL validator using only external storage GET. Remote browser checks create a preverified synthetic account and a workspace, upload Product references, and publish a static diagnostic Content fixture without provider execution or a charge. They revoke all fixture sessions, disable the account, and archive its Product/Content afterward. Immutable fixture history is retained. The HTML diagnostic briefly reactivates only that retired account, creates a short session, compares origin/edge HTML, and restores its original status. Do not use these checks against production.

`node tests/stabilization/secret-audit.mjs` reports only finding categories, never matched credential values. Private `.env.local`, temporary logs, browser output and worker work directories remain ignored. `scripts/rotate-test-storage.mjs` is a separately invoked credential-rotation operation, not part of these test suites; it must not be rerun merely to repeat verification.
