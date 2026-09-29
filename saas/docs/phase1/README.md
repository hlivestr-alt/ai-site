# Phase 1: customer identity and workspaces

The implementation lives entirely in `C:\Data\ai-site\saas`. It is a Next.js 16 / React 19 service with a separate Postgres 17 database. No code or tables from the internal AI Site, H3 Bridge, Clipper, Outreach, Creative Studio or ComfyUI are imported.

Implemented customer journey: register → verify email → create workspace → see a truthful empty Home → invite a teammate → teammate verifies and accepts → each sees their permitted workspace view. A member of multiple workspaces can switch; every server route checks active membership.

Only Home and Settings are in the navigation. Future product, generation, workflow, billing and analytics routes have not been created. The “Preview” mark is temporary neutral branding.

Documents: [authentication](authentication.md), [workspaces](workspaces.md), [roles](roles-and-permissions.md), [invitations](invitations.md), [isolation tests](isolation-tests.md), [database](database.md), [local development](local-development.md), and [Phase 2 handoff](phase2-handoff.md).
