# Master acceptance 20–28

Run from `saas`:

```powershell
node tests/master-acceptance/run.mjs
```

Requires the configured, distinct `TEST_DATABASE_URL`, existing local Docker PostgreSQL/LocalStack, private storage gateway, Chrome, and optionally Edge. The runner refuses shared customer/test databases, creates an owned database/bucket/gateway, uses ports 3217/9017, pins fake inference/payment providers, and clears real paid-provider keys in child processes. It drops only its new database/bucket/gateway and removes its own local mailbox fixtures on completion.

The full run provisions a fresh controlled identity in the remote-test database to avoid the known signup delivery issue. It creates an empty QA workspace through the real API, uses real browser login, and retires the identity and its sessions afterward. Existing users/workspaces/jobs/assets are not modified. Empty QA account/workspace records remain for provenance. Signing attacks address only objects in the owned bucket and controlled workspaces, including through the real public storage endpoint.

Known defects intentionally leave failing assertions. Test results, secret-safe JSON evidence, and responsive failure screenshots (when any) are in `docs/master-acceptance-evidence/`. Detailed runtime results are in ignored `test-data/master-acceptance/`.

For the isolated persistence supplement, including an unstarted workflow definition and fake paid payment:

```powershell
node tests/master-acceptance/run.mjs --persistence-only
```

This does not provision a remote account or execute a workflow. It tests logout → new context → real form login → persisted reads, using a new local database/bucket.

After a full run, the optional read-only HTML diagnostic compares origin/Cloudflare transformations using only the owned retired QA fixture. It temporarily reactivates that fixture, creates and revokes a two-minute diagnostic session, and restores its prior status without changing its password:

```powershell
node tests/master-acceptance/remote-html-diagnostic.mjs
```

Do not run this against a production customer environment. No real inference, outreach, production TTL changes, credential rotation, public bucket changes, or global authorization bypass is part of this harness.
