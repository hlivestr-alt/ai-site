# AI Site UI and namespace migration

The workspace contains the original repositories at `C:\Data\ai-site\app` and `C:\Data\ai-site\h3-bridge`. The platform's commit history and the bridge's existing Git metadata were preserved; the bridge has not yet had an initial commit. Pre-existing working-tree changes remain in place.

## Interface

Home, AI Videos, Clipper, Outreach, Settings, and Login share the same theme tokens, line icons, sidebar, typography, cards, status badges, and orange accent. Light and dark preferences persist under `ai_site_theme`. Search is an explicitly unavailable visual placeholder. Metrics are derived from recent authoritative records; unavailable values use a dash. There are no upsells, fabricated growth figures, or unsupported native controls.

AI Videos preserves its multipart submission, UUID idempotency, one/two-image validation, 8-second duration, portrait format, polling, waiting-job action, and artifact endpoints. Its history filters operate locally. Clipper remains a monitor and native-app launch point. Campaign creation, preview, freeze, and final confirmation keep their established contracts and server gate.

## Configuration and sessions

Platform-owned authentication settings are now `AI_SITE_PASSWORD_HASH` and `AI_SITE_SESSION_SECRET`; their existing values were retained in ignored `.env.local`. The session cookie is `ai_site_session`. The old cookie is no longer accepted, so the operator must sign in again after migration. Authentication still uses server-side opaque sessions, HttpOnly/SameSite cookies, expiry, login throttling, and same-origin write protection. Auth transitions perform a full navigation to clear cached pages after login or logout.

`OUTREACH_QUEUE_ENABLED` retains its existing value. No production enablement is part of this phase. The bridge's previously validated real-submission flag is retained in its ignored `.env.local`, which its start/dev commands and platform launcher load. It still requires the existing controlled-test marker and idle service checks before permitting a request.

## Historical compatibility

New bridge uploads and outputs use `ai_site/<job-id>`; new prompt metadata uses `aiSiteBridgeJobId`. Existing persisted jobs, prompts, event logs, workflows, uploaded references, and videos remain untouched. Some historical runtime files retain former text and identifiers; these are runtime exceptions, not new product branding.

The historical identity key and output namespace are constructed from exact compatibility bytes in `h3-bridge/src/legacy.ts` and used only when reading/reconciling existing ComfyUI records. Exact UUID, prompt identity, filename, and subfolder checks remain in place. The external Creative Studio runner's established route prefix also retains its exact protocol bytes. Its application, routes, repository, and branding have not been renamed.

The owned workflow template changed only its descriptive metadata property to `ai_site_h3_workflow_defaults`. Reconstruction of the original bytes matched the previously reviewed checksum; no generation node, link, or default changed. The renamed template is pinned to SHA-256 `e4d20993f4dd33d121a67050c1ebe05f85d7a1c776176c1fbe3cfc981094b465`.

## Verification commands

Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` in each project. In the app, `npm run test:ui` runs an isolated server on 3101 with synthetic credentials and mocked service reads. It uses installed Microsoft Edge. It does not generate a video, create a production draft, freeze native recipients, queue a campaign, or send a creator message. The existing adapter tests validate draft/preview/freeze contracts with mocked dependencies.

From the app, `node --env-file=.env.local --import tsx scripts/visual-review.mts` captures the live pages with a temporary valid operator session, blocks browser writes, checks both workstation widths, and revokes that session afterward. Screenshots and validation reports are stored outside both repositories in `C:\Data\ai-site\validation`. The script preserves historical user-authored content as displayed by the real service.

Owned source/project files and filenames are audited case-insensitively. Git internals and third-party dependency caches are excluded; preserved runtime matches are reported separately. Existing external repository statuses and owned-file hashes are compared against the pre-change snapshot. No schema migration or external source write occurs.

Inherited campaign titles are neutralized for display only. The UI explains this treatment; original native names, messages, identifiers, and request payloads remain unchanged. The campaign table uses local pagination and filtering over authoritative recent records.
