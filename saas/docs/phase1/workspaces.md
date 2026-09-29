# Workspaces and membership

`POST /api/workspaces` creates a workspace, Owner membership and audit event in one transaction. `GET /api/workspaces` lists only the signed-in user's active workspaces. `POST /api/workspaces/:workspaceId/select` verifies active membership before updating that session's active workspace. Home and Settings revalidate the selected workspace on the server.

Workspace detail, member, invitation and audit routes take a workspace ID and call shared authorization helpers in `src/lib/workspaces.ts`. They do not trust the current switcher value or a browser-provided ID as proof of access. Workspace-scoped queries also filter by `workspace_id` and nested object ID.

Membership has a unique `(workspace_id,user_id)` pair. Removed users are inactive and can no longer access the workspace. Changes to roles/removal lock the workspace row and reject an operation leaving zero active Owners. Owner transfer requires assigning another Owner before demoting or removing the last one.
