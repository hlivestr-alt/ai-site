export type Role = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
export type Permission = "workspace:read" | "workspace:update" | "team:read" | "team:manage" | "audit:read" | "future:edit" | "future:spend" | "future:billing";
const grants: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(["workspace:read","workspace:update","team:read","team:manage","audit:read","future:edit","future:spend","future:billing"]),
  ADMIN: new Set(["workspace:read","workspace:update","team:read","team:manage","audit:read","future:edit","future:spend"]),
  EDITOR: new Set(["workspace:read","team:read","future:edit","future:spend"]),
  VIEWER: new Set(["workspace:read","team:read"]),
};
export function can(roleValue: Role, permission: Permission): boolean { return grants[roleValue].has(permission); }
