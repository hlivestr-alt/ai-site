# Phase 2 handoff: Products and Storage

Phase 2 may rely on active users, workspaces, memberships, session lookup (`getSession`), membership/role checks (`requireMembership`, `requireRole`), explicit object-to-workspace checks (`requireWorkspaceObjectAccess`) and the matrix in `permissions.ts`.

Required Phase 2 contract: each Product and Product Asset must have one immutable `workspace_id` owner (or an unambiguous parent Product belonging to one workspace). Every read/write/list/aggregate/storage URL issuance must derive workspace scope from an authenticated active membership, then filter by both object ID and workspace ID. Object ID alone never grants access. Media paths and signed URLs must be scoped to the same workspace; authorize before issuing, uploading, downloading or deleting. Do not expose the local database token/hash fields to clients.

Build next: Product and Product Asset schema migrations, workspace-scoped storage service, asset access rules, CRUD APIs and UI, and cross-workspace object-ID substitution tests. Keep the runtime isolated from the internal AI Site. Do not add real generation, Clipper, Tokens, payments, Outreach or workflows until their planned later phases.

Remaining deployment blockers: production email transport, public-domain/session/cookie configuration, operational backups/monitoring, and security review. Phase 1 has no customer media storage or Products yet.
