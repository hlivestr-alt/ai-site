import "server-only";
import { query, transaction, type DbClient } from "./db";
import { AppError, audit, hashToken, isUuid, normalizeEmail, randomToken, role, workspaceName } from "./core";
import type { Session } from "./auth";
import { can, type Role, type Permission } from "./permissions";

export type { Role, Permission } from "./permissions";

export async function requireMembership(userId: string, workspaceId: string, db: DbClient = { query }) {
  if (!isUuid(workspaceId)) throw new AppError(404, "Workspace not found.");
  const found = await db.query<{ id: string; role: Role; status: string; workspace_name: string }>(`
    SELECT m.id,m.role,m.status,w.name AS workspace_name FROM workspace_members m
    JOIN workspaces w ON w.id=m.workspace_id
    WHERE m.user_id=$1 AND m.workspace_id=$2 AND m.status='ACTIVE' AND w.status='ACTIVE'`, [userId, workspaceId]);
  if (!found.rows[0]) throw new AppError(404, "Workspace not found.");
  return found.rows[0];
}

export async function requireRole(userId: string, workspaceId: string, permission: Permission, db: DbClient = { query }) {
  const membership = await requireMembership(userId, workspaceId, db);
  if (!can(membership.role, permission)) throw new AppError(403, "You do not have permission for this action.");
  if(permission==="future:spend"||permission==="billing:manage"){
    const locked=await db.query<{role:Role}>("SELECT m.role FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND m.workspace_id=$2 AND m.status='ACTIVE' AND w.status='ACTIVE' FOR SHARE OF m,w",[userId,workspaceId]);
    if(!locked.rows[0])throw new AppError(404,"Workspace not found.");
    if(!can(locked.rows[0].role,permission))throw new AppError(403,"You do not have permission for this action.");
  }
  return membership;
}

export async function requireWorkspaceObjectAccess(userId: string, workspaceId: string, objectWorkspaceId: string, db: DbClient = { query }) {
  if (workspaceId !== objectWorkspaceId) throw new AppError(404, "Resource not found.");
  return requireMembership(userId, workspaceId, db);
}

export async function listWorkspaces(userId: string, db:DbClient={query}) {
  const result = await db.query<{ id: string; name: string; slug: string; role: Role }>(`
    SELECT w.id,w.name,w.slug,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id
    WHERE m.user_id=$1 AND m.status='ACTIVE' AND w.status='ACTIVE' ORDER BY m.created_at,w.name`, [userId]);
  return result.rows;
}

export async function currentWorkspace(session: Session,db:DbClient={query}) {
  const memberships = await listWorkspaces(session.userId,db);
  return memberships.find(w => w.id === session.activeWorkspaceId) ?? memberships[0] ?? null;
}

export async function createWorkspace(userId: string, nameInput: unknown) {
  const name = workspaceName(nameInput);
  const slugBase = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,45) || "workspace";
  return transaction(async db => {
    const workspace = await db.query<{ id: string; name: string; slug: string }>("INSERT INTO workspaces(name,slug,created_by) VALUES($1,$2,$3) RETURNING id,name,slug", [name, `${slugBase}-${randomToken().slice(0,8).toLowerCase()}`, userId]);
    await db.query("INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,'OWNER','ACTIVE')", [workspace.rows[0].id,userId]);
    await audit(db, { workspaceId: workspace.rows[0].id, actorUserId: userId, type: "WORKSPACE_CREATED", targetType: "workspace", targetId: workspace.rows[0].id });
    await audit(db,{workspaceId:workspace.rows[0].id,actorUserId:userId,type:"WALLET_CREATED",targetType:"workspace",targetId:workspace.rows[0].id});
    return workspace.rows[0];
  });
}

export async function switchWorkspace(session: Session, workspaceId: string) {
  await requireMembership(session.userId, workspaceId);
  await query("UPDATE sessions SET active_workspace_id=$1 WHERE id=$2 AND user_id=$3 AND revoked_at IS NULL", [workspaceId,session.id,session.userId]);
  return { workspaceId };
}

export async function renameWorkspace(userId: string, workspaceId: string, nameInput: unknown) {
  const name = workspaceName(nameInput);
  return transaction(async db => {
    await requireRole(userId,workspaceId,"workspace:update",db);
    const result = await db.query<{ id: string; name: string; slug: string }>("UPDATE workspaces SET name=$1,updated_at=now() WHERE id=$2 RETURNING id,name,slug", [name,workspaceId]);
    await audit(db,{workspaceId,actorUserId:userId,type:"WORKSPACE_UPDATED",targetType:"workspace",targetId:workspaceId});
    return result.rows[0];
  });
}

export async function members(userId: string, workspaceId: string) {
  await requireRole(userId,workspaceId,"team:read");
  const result = await query<{ id: string; user_id: string; email: string; display_name: string; role: Role; status: string; created_at: Date }>(`
    SELECT m.id,m.user_id,u.email,u.display_name,m.role,m.status,m.created_at
    FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.status='ACTIVE' ORDER BY m.created_at`, [workspaceId]);
  return result.rows;
}

async function lockedTeamContext(db: DbClient, actorId: string, workspaceId: string) {
  if (!isUuid(workspaceId)) throw new AppError(404,"Workspace not found.");
  const workspace = await db.query("SELECT id FROM workspaces WHERE id=$1 AND status='ACTIVE' FOR UPDATE", [workspaceId]);
  if (!workspace.rows[0]) throw new AppError(404,"Workspace not found.");
  return requireRole(actorId,workspaceId,"team:manage",db);
}

export async function changeMemberRole(actorId: string, workspaceId: string, memberId: string, nextRoleInput: unknown) {
  const nextRole = role(nextRoleInput);
  if (!isUuid(memberId)) throw new AppError(404,"Member not found.");
  return transaction(async db => {
    const actor = await lockedTeamContext(db,actorId,workspaceId);
    const target = await db.query<{ id: string; user_id: string; role: Role }>("SELECT id,user_id,role FROM workspace_members WHERE workspace_id=$1 AND id=$2 AND status='ACTIVE' FOR UPDATE", [workspaceId,memberId]);
    const member = target.rows[0];
    if (!member) throw new AppError(404,"Member not found.");
    if (actor.role === "ADMIN" && (member.role === "OWNER" || nextRole === "OWNER" || member.user_id === actorId)) throw new AppError(403,"Only an Owner can change this role.");
    if (member.role === "OWNER" && nextRole !== "OWNER") {
      const count = await db.query<{ count: string }>("SELECT count(*) FROM workspace_members WHERE workspace_id=$1 AND role='OWNER' AND status='ACTIVE'", [workspaceId]);
      if (Number(count.rows[0].count) <= 1) throw new AppError(409,"A workspace must retain an Owner.");
    }
    const updated = await db.query<{ id: string; role: Role }>("UPDATE workspace_members SET role=$1,updated_at=now() WHERE id=$2 RETURNING id,role", [nextRole,memberId]);
    await audit(db,{workspaceId,actorUserId:actorId,type:"MEMBER_ROLE_CHANGED",targetType:"workspace_member",targetId:memberId,metadata:{from:member.role,to:nextRole}});
    return updated.rows[0];
  });
}

export async function removeMember(actorId: string, workspaceId: string, memberId: string) {
  if (!isUuid(memberId)) throw new AppError(404,"Member not found.");
  return transaction(async db => {
    const actor = await lockedTeamContext(db,actorId,workspaceId);
    const target = await db.query<{ id: string; user_id: string; role: Role }>("SELECT id,user_id,role FROM workspace_members WHERE workspace_id=$1 AND id=$2 AND status='ACTIVE' FOR UPDATE", [workspaceId,memberId]);
    const member = target.rows[0];
    if (!member) throw new AppError(404,"Member not found.");
    if (actor.role === "ADMIN" && (member.role === "OWNER" || member.user_id === actorId)) throw new AppError(403,"Only an Owner can remove this member.");
    if (member.role === "OWNER") {
      const count = await db.query<{ count: string }>("SELECT count(*) FROM workspace_members WHERE workspace_id=$1 AND role='OWNER' AND status='ACTIVE'", [workspaceId]);
      if (Number(count.rows[0].count) <= 1) throw new AppError(409,"A workspace must retain an Owner.");
    }
    await db.query("UPDATE workspace_members SET status='REMOVED',updated_at=now() WHERE id=$1", [memberId]);
    await audit(db,{workspaceId,actorUserId:actorId,type:"MEMBER_REMOVED",targetType:"workspace_member",targetId:memberId});
  });
}

export async function createInvitation(actorId: string, workspaceId: string, emailInput: unknown, roleInput: unknown) {
  const email = normalizeEmail(emailInput), intendedRole = role(roleInput), token = randomToken();
  const invitation = await transaction(async db => {
    const actor = await lockedTeamContext(db,actorId,workspaceId);
    if (actor.role === "ADMIN" && intendedRole === "OWNER") throw new AppError(403,"Only an Owner can invite another Owner.");
    const existing = await db.query("SELECT 1 FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND u.email=$2 AND m.status='ACTIVE'", [workspaceId,email]);
    if (existing.rows[0]) throw new AppError(409,"This person already belongs to the workspace.");
    await db.query("UPDATE workspace_invitations SET status='EXPIRED',updated_at=now() WHERE workspace_id=$1 AND email=$2 AND status='PENDING' AND expires_at<=now()", [workspaceId,email]);
    const created = await db.query<{ id: string; workspace_name: string }>(`
      WITH inserted AS (INSERT INTO workspace_invitations(workspace_id,email,intended_role,token_hash,created_by,expires_at)
        VALUES($1,$2,$3,$4,$5,now()+interval '7 days') RETURNING id,workspace_id)
      SELECT inserted.id,w.name AS workspace_name FROM inserted JOIN workspaces w ON w.id=inserted.workspace_id`, [workspaceId,email,intendedRole,hashToken(token),actorId]);
    await audit(db,{workspaceId,actorUserId:actorId,type:"INVITATION_CREATED",targetType:"workspace_invitation",targetId:created.rows[0].id,metadata:{role:intendedRole}});
    return created.rows[0];
  });
  return { ...invitation, token, email, intendedRole };
}

export async function listInvitations(actorId: string, workspaceId: string) {
  await requireRole(actorId,workspaceId,"team:manage");
  const rows = await query<{ id: string; email: string; intended_role: Role; status: string; expires_at: Date; created_at: Date }>("SELECT id,email,intended_role,status,expires_at,created_at FROM workspace_invitations WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100", [workspaceId]);
  return rows.rows;
}

export async function getInvitation(actorId: string, workspaceId: string, invitationId: string) {
  await requireRole(actorId,workspaceId,"team:manage");
  if (!isUuid(invitationId)) throw new AppError(404,"Invitation not found.");
  const row = await query<{ id: string; email: string; intended_role: Role; status: string; expires_at: Date }>("SELECT id,email,intended_role,status,expires_at FROM workspace_invitations WHERE workspace_id=$1 AND id=$2", [workspaceId,invitationId]);
  if (!row.rows[0]) throw new AppError(404,"Invitation not found.");
  return row.rows[0];
}

export async function cancelInvitation(actorId: string, workspaceId: string, invitationId: string) {
  if (!isUuid(invitationId)) throw new AppError(404,"Invitation not found.");
  return transaction(async db => {
    await lockedTeamContext(db,actorId,workspaceId);
    const changed = await db.query("UPDATE workspace_invitations SET status='CANCELLED',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status='PENDING' RETURNING id", [workspaceId,invitationId]);
    if (!changed.rows[0]) throw new AppError(404,"Pending invitation not found.");
    await audit(db,{workspaceId,actorUserId:actorId,type:"INVITATION_CANCELLED",targetType:"workspace_invitation",targetId:invitationId});
  });
}

export async function invitationPreview(raw: string) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(raw)) throw new AppError(404,"Invitation not found.");
  const row = await query<{ workspace_name: string; intended_role: Role; status: string; expires_at: Date }>("SELECT w.name AS workspace_name,i.intended_role,i.status,i.expires_at FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=$1", [hashToken(raw)]);
  const invite = row.rows[0];
  if (!invite || invite.status !== "PENDING" || invite.expires_at <= new Date()) throw new AppError(404,"Invitation not found.");
  return { workspaceName: invite.workspace_name, role: invite.intended_role, expiresAt: invite.expires_at };
}

export async function acceptInvitation(userId: string, email: string, raw: string) {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(raw)) throw new AppError(404,"Invitation not found.");
  return transaction(async db => {
    const found = await db.query<{ id: string; workspace_id: string; email: string; intended_role: Role; status: string; expires_at: Date; accepted_by: string | null }>("SELECT * FROM workspace_invitations WHERE token_hash=$1 FOR UPDATE", [hashToken(raw)]);
    const invite = found.rows[0];
    if (!invite) throw new AppError(404,"Invitation not found.");
    if (invite.email !== email) throw new AppError(403,"Sign in with the invited email address.");
    if (invite.status === "ACCEPTED" && invite.accepted_by === userId) {
      await requireMembership(userId,invite.workspace_id,db);
      return { workspaceId: invite.workspace_id, alreadyAccepted: true };
    }
    if (invite.status !== "PENDING" || invite.expires_at <= new Date()) throw new AppError(410,"Invitation expired or unavailable.");
    await db.query(`INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,$3,'ACTIVE')
      ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='ACTIVE',updated_at=now()`, [invite.workspace_id,userId,invite.intended_role]);
    await db.query("UPDATE workspace_invitations SET status='ACCEPTED',accepted_by=$1,accepted_at=now(),updated_at=now() WHERE id=$2", [userId,invite.id]);
    await audit(db,{workspaceId:invite.workspace_id,actorUserId:userId,type:"INVITATION_ACCEPTED",targetType:"workspace_invitation",targetId:invite.id});
    return { workspaceId: invite.workspace_id, alreadyAccepted: false };
  });
}

export async function workspaceAudit(actorId: string, workspaceId: string) {
  await requireRole(actorId,workspaceId,"audit:read");
  const result = await query<{ id: string; event_type: string; target_type: string; occurred_at: Date; actor_email: string | null }>(`
    SELECT a.id,a.event_type,a.target_type,a.occurred_at,u.email AS actor_email FROM audit_events a
    LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.workspace_id=$1 ORDER BY a.occurred_at DESC LIMIT 30`, [workspaceId]);
  return result.rows;
}
