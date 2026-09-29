# Database and migrations

The SaaS-owned Postgres 17 volume is `ai-site-saas_saas_postgres_data`; local port `127.0.0.1:5543` avoids the internal app's runtime and persistence. `saas_dev` and `saas_test` are distinct databases within that local stack.

Migration `0001_identity_workspaces.sql` creates `users`, `workspaces`, `workspace_members`, `sessions`, `auth_tokens`, `workspace_invitations`, `audit_events`, and `auth_rate_limits`. The runner tracks SHA-256 checksums in `schema_migrations`, serializes runs using a Postgres advisory lock, and applies each migration in a transaction. Run `npm run db:migrate` and `npm run db:status` against the development URL.

Migrations are forward-only. To reverse one in development, restore a snapshot or recreate the separate development volume, then replay desired migrations. For deployed environments, write a reviewed compensating migration and restore from a backup if needed; do not edit an applied migration because its checksum is enforced. No existing internal or native database is migrated.

`npm run db:seed:test` is explicit and requires local mode. It inserts Brand A Owner, Brand A Editor and Brand B Owner with two separate workspaces. It never runs during normal start/build or production runtime and prints the generated test password. Do not use these accounts outside local development.
