# Invitations

Owner and Admin can invite a normalized email with one of the four roles, subject to Admin limits. The database permits only one pending invitation for an email within a workspace. Expired pending rows are marked expired before a fresh invite can be created.

The 32-byte invitation token is delivered through the local mail sink; Postgres stores only its SHA-256 hash. The link expires after seven days. The recipient registers or signs in with the exact invited email, then accepts. Acceptance uses the role and workspace stored on the invitation, ignores client-supplied role/workspace data, creates or restores a membership, marks the invitation accepted, and writes an audit event in one transaction. Reacceptance by the same user returns success without a second membership; other users and unavailable tokens are rejected.

The link preview exposes only workspace name, intended role and expiry to a bearer of the link. The app sets `Referrer-Policy: no-referrer` and no-cache API responses to reduce link exposure.
