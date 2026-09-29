# Tenant isolation tests

`tests/integration/foundation.spec.ts` creates Brand A and Brand B owners/workspaces in the separate `saas_test` database. It substitutes Brand B's workspace ID into Brand A's GET, POST and PATCH requests and substitutes Brand B's member ID into Brand A's PATCH and DELETE requests. It also substitutes invitation IDs across workspaces. These return 403/404, and Brand B's name and member count remain unchanged.

The test checks Editor and Viewer inability to administer the team, Admin inability to promote self or remove the Owner, protection of the final Owner, denied access after inactive membership, accepted invitation idempotency, wrong email rejection, invitation expiry, session expiry, recovery token expiry/single use and audit events without secrets.

`tests/browser/journey.spec.ts` uses real Chromium UI interactions for registration, verification, workspace creation, invitation, Editor acceptance, role-limited Settings, sign-out and protected page redirect. Tests never call H3, Clipper, Outreach, generation or payment systems.
