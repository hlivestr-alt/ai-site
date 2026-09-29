# Roles and permissions

The reusable matrix is in `src/lib/permissions.ts`; mutation paths enforce it through `requireRole` in `src/lib/workspaces.ts`.

| Capability | Owner | Admin | Editor | Viewer |
|---|---:|---:|---:|---:|
| Read workspace and team | Yes | Yes | Yes | Yes |
| Update workspace | Yes | Yes | No | No |
| Invite/manage members | Yes | Yes, non-Owner only | No | No |
| Read workspace audit | Yes | Yes | No | No |
| Future content editing | Reserved | Reserved | Reserved | No |
| Future token spending | Reserved | Reserved | Reserved | No |
| Future billing ownership | Reserved | No | No | No |

“Reserved” is a declared authorization contract, not an implemented operational feature. An Admin cannot promote anyone to Owner, alter an Owner, or change their own role. A workspace always retains an active Owner.
