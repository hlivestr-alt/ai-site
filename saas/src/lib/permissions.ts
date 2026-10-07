export type Role = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";
export type Permission = "workspace:read" | "workspace:update" | "team:read" | "team:manage" | "audit:read" | "future:edit" | "future:spend" | "future:billing" | "billing:manage" | "outreach:view" | "outreach:create" | "outreach:send" | "outreach:manage" | "outreach:channel_manage";
const grants: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(["outreach:view","outreach:create","outreach:send","outreach:manage","outreach:channel_manage","workspace:read","workspace:update","team:read","team:manage","audit:read","future:edit","future:spend","future:billing","billing:manage"]),
  ADMIN: new Set(["outreach:view","outreach:create","outreach:send","outreach:manage","outreach:channel_manage","workspace:read","workspace:update","team:read","team:manage","audit:read","future:edit","future:spend","billing:manage"]),
  EDITOR: new Set(["outreach:view","outreach:create","workspace:read","team:read","future:edit","future:spend"]),
  VIEWER: new Set(["outreach:view","workspace:read","team:read"]),
};
export function can(roleValue: Role, permission: Permission): boolean { return grants[roleValue].has(permission); }
