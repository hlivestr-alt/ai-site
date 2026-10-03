# Remote-test private storage

Use the existing LocalStack backend and loopback SigV4 gateway for controlled multi-PC testing. This remains `APP_ENV=local`; it does not qualify as production storage or set `PRODUCTION_STORAGE_VERIFIED=1`. Phase 9 staging/production checks still validate the internal provider and require real storage acceptance.

## Files changed

All paths below are relative to `saas`:

| Area | Files | Change |
| --- | --- | --- |
| Storage | `src/lib/storage.ts` | Separate internal and browser-signing S3 clients |
| Browser policy | `src/proxy.ts` | Permit configured public storage origin in CSP |
| Phase 9 validation | `src/lib/operational-config.ts`, `tests/unit/operations.test.ts` | Validate optional public endpoint; prove local tunnel cannot qualify as production storage |
| Gateway | `docker/s3-gateway.mjs`, `docker/storage-gateway-config.mjs` | Exact Host/origin allowlists, unchanged canonical Host, bounded CORS headers, no-store responses, local/test-only gateway |
| Local deployment | `compose.yml`, `.env.example` | Pass optional endpoint/origins/region/mode into the existing gateway on port 9000 |
| Private buckets | `scripts/storage-init.mjs` | Apply exact-origin/header CORS and preserve public access blocks |
| Test entry points | `package.json`, `playwright.config.ts`, `playwright.remote-storage.config.ts` | Add remote storage test command; keep single-PC fixtures/dispatchers explicitly local |
| Storage tests | `tests/unit/storage.test.ts`, `tests/unit/storage-gateway.test.ts`, `tests/integration/remote-storage.spec.ts` | Signing/routing, gateway security/CORS and real LocalStack acceptance |
| Documentation | `README.md`, `docs/phase2/storage.md`, `docs/remote-test-storage.md` | Operator setup, route/Host settings, verification and second-PC acceptance |

## Endpoints

`OBJECT_STORAGE_ENDPOINT` is the server endpoint. `storageClient()` uses it for bucket health, HeadObject, streamed GetObject, CopyObject, PutObject (including files), DeleteObject, Create/Complete/List/Abort multipart, and UploadPartCopy.

`OBJECT_STORAGE_PUBLIC_ENDPOINT` is optional. `storageSigningClient()` uses it only when issuing PUT uploads, GET downloads/previews and multipart UploadPart URLs. The region, credentials and path-style addressing match the internal client. The public host participates in SigV4 from the start. No hostname replacement occurs. Existing authorization and TTLs remain in their service methods. The SaaS CSP permits the configured endpoint for browser connections, images and media.

Single-PC `.env.local`:

```dotenv
APP_ENV=local
APP_BASE_URL=http://127.0.0.1:3200
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000
OBJECT_STORAGE_PUBLIC_ENDPOINT=
OBJECT_STORAGE_ALLOWED_ORIGINS=http://127.0.0.1:3200
PRODUCTION_STORAGE_VERIFIED=0
```

Remote multi-PC `.env.local` (keep the existing private bucket, region and credentials):

```dotenv
APP_ENV=local
APP_BASE_URL=https://ai-test.proyaofficial.com
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000
OBJECT_STORAGE_PUBLIC_ENDPOINT=https://storage-test.proyaofficial.com
OBJECT_STORAGE_ALLOWED_ORIGINS=http://127.0.0.1:3200,https://ai-test.proyaofficial.com
PRODUCTION_STORAGE_VERIFIED=0
```

No real credentials belong in version control. An empty public endpoint retains the internal hostname in all signatures.

## Cloudflare route and canonical Host

Add only this published application route to the existing tunnel:

```yaml
- hostname: storage-test.proyaofficial.com
  service: http://localhost:9000
  originRequest:
    httpHostHeader: storage-test.proyaofficial.com
```

For a dashboard-managed tunnel, set **Public hostname** to `storage-test.proyaofficial.com`, **Service** to `http://localhost:9000`, and that route's **HTTP Host Header** to `storage-test.proyaofficial.com`. Scope the setting to the storage route. The existing `ai-test.proyaofficial.com` to `http://localhost:3200` route stays as it is. No additional local port is required. LocalStack port 4566 remains unpublished.

Cloudflare's [`httpHostHeader` origin parameter](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/#httphostheader) explicitly sets the HTTP Host delivered to the origin. The gateway verifies the actual `Host` and forwards that same value to LocalStack. It accepts only `127.0.0.1:9000`, `localhost:9000` and the exact configured public endpoint host. `X-Forwarded-Host` and `X-Forwarded-Proto` never replace the canonical host. A signature for an unrelated host is rejected even if it is otherwise cryptographically valid. A public signature delivered with a rewritten loopback Host is also rejected. HTTPS at the edge and HTTP at the loopback origin are compatible because the scheme is not a SigV4 canonical header; Host, method, path, query and signed headers still must match.

Keep edge cache rules from overriding origin `Cache-Control: private, no-store` on this storage hostname. Signed URLs must reach verification rather than become cached permanent access. The gateway also denies unsigned public `/health`, object reads and bucket listing. The loopback `/health` remains available for Compose health checks.

## CORS and restarting

`OBJECT_STORAGE_ALLOWED_ORIGINS` is a comma-separated list of exact HTTP(S) origins. The default is `http://127.0.0.1:3200`. Add the remote UI explicitly while retaining that local origin. Wildcards, wildcard subdomains, `null`, credentials and path-bearing origins are rejected. Unrelated browser origins receive 403 and no allow-origin header. Requests without Origin still require SigV4.

Preflight permits GET, HEAD and PUT, with a bounded header list covering content type, range/conditional requests and SDK signing/checksum headers. Multipart UploadPart is a signed PUT; multipart creation, listing, completion and abort continue server-side. CORS exposes ETag, Content-Length, Content-Range and Accept-Ranges. Upstream CORS headers cannot expand the gateway allowlist. `storage:init` applies the same exact origins to both private local buckets and reapplies public access blocks without erasing data.

After editing `.env.local`, from `saas`:

```powershell
docker compose --env-file .env.local up -d --force-recreate object-gateway
npm run storage:init
# Restart the existing SaaS process using its current dev/start command.
```

Compose recreation is required to pick up changed environment variables; `docker compose restart` alone retains the old values.

## Automated checks

`npm run test:unit` covers fallback/public PUT/GET/UploadPart signing, real internal request transport for every backend operation, CSP, valid/unsigned/forged/expired signatures, canonical Host and forwarded-header spoofing, exact-origin CORS, default localhost CORS and Phase 9 configuration guards.

With the gateway configured for the remote endpoint/origins above, `npm run test:remote-storage` uses the existing port 9000 and isolated test database/bucket. It simulates cloudflared's local delivery of the unchanged external Host without requiring DNS or a live tunnel. It exercises real LocalStack Product image/video upload/finalize/download, source upload/download, multipart part upload/resume/complete/seal, range reads, expiration and foreign-workspace denial before signing. The test SaaS runs with a loopback APP_BASE_URL so existing test-only identity fixtures stay local. This does not claim second-PC or Cloudflare edge acceptance.

`npm run test:browser` explicitly sets a loopback APP_BASE_URL and leaves public signing empty for existing single-PC regressions, even when `.env.local` enables remote access/signing. CLI fixtures and dispatcher subprocesses inherit that same local test origin, so Phase 9 continues to permit simulations only in the isolated localhost harness. Run `npm run lint`, `npm run typecheck` and `npm run build` as usual.

### Verified results — 2026-10-03

| Check | Result |
| --- | --- |
| `npm run test:unit` | 40 passed, including all new storage/gateway and Phase 9 guard checks |
| `npm run test:remote-storage` | 2 passed against real private LocalStack storage with the external canonical Host |
| `npm run test:browser` | All 37 existing localhost browser/integration tests passed, including Product, Clipper and Content media/isolation |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed after build |
| `npm run build` | Optimized Next.js build passed |
| `git diff --check` | Passed |

Backend routing was verified with actual HTTP transport for HeadBucket/HeadObject/GetObject/CopyObject/PutObject/putFile/DeleteObject and every multipart control/copy command. Public-signing LocalStack acceptance also finalized and sealed real image/video/source objects through the loopback client. Browser PUT, GET and UploadPart URL example hostname: `storage-test.proyaofficial.com` for each operation; no signed URLs or credentials are included in this report.

Remote-test gateway environment settings were temporary during automated acceptance. The existing gateway and private bucket CORS were restored from the existing `.env.local`: internal endpoint `http://127.0.0.1:9000`, public endpoint empty, allowed origin `http://127.0.0.1:3200`; the gateway is healthy and raw LocalStack ports remain unpublished. `.env.local` and Cloudflare routes were not edited. Actual Cloudflare edge/second-PC acceptance remains for the operator after the setup below.

## Second-PC acceptance

From another PC, open `https://ai-test.proyaofficial.com` and verify:

1. Product reference upload: SaaS upload-intent request succeeds, PUT hostname is `storage-test.proyaofficial.com`, then SaaS finalization succeeds.
2. Product image/video preview and seek: signed GET hostname is `storage-test.proyaofficial.com` and range/media responses succeed.
3. Clipper source simple/multipart upload: PUT/UploadPart hostname is `storage-test.proyaofficial.com`; resume/finalize succeed.
4. Content preview/download: signed GET hostname is `storage-test.proyaofficial.com`.
5. Unsigned storage object/listing requests fail. An unrelated workspace cannot obtain an upload/download/part signature.

Check actual Cloudflare upload/timeout limits for the zone. Product videos use single PUTs and therefore remain subject to the edge's request-size limit; source multipart parts remain 64 MiB. See Cloudflare's [upload limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/#upload-limits). A local tunnel test does not replace production provider, large-object, retention, backup or restore acceptance.
