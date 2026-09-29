import { Shell } from "@/components/shell";
import { SettingsClient } from "@/components/settings-client";
import { pageWorkspace } from "@/lib/page";
import { members, listInvitations, workspaceAudit } from "@/lib/workspaces";

export default async function Settings() {
  const { session, workspaces, current } = await pageWorkspace();
  const canManage = current.role === "OWNER" || current.role === "ADMIN";
  const [team, invitations, events] = await Promise.all([
    members(session.userId, current.id),
    canManage ? listInvitations(session.userId, current.id) : Promise.resolve([]),
    canManage ? workspaceAudit(session.userId, current.id) : Promise.resolve([]),
  ]);
  return <Shell user={session} workspaces={workspaces} current={current}><SettingsClient workspace={current} userId={session.userId} userEmail={session.email} userName={session.displayName} initialMembers={team} initialInvitations={invitations.map(i=>({...i,expires_at:i.expires_at.toISOString()}))} events={events.map(e=>({...e,occurred_at:e.occurred_at.toISOString()}))} /></Shell>;
}
