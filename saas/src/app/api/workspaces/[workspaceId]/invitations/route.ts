import { createInvitation, listInvitations } from "@/lib/workspaces";
import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { deliverLocalMail } from "@/lib/mail";

type Context = {params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context) { return handle(async () => {
  const session = await requestSession(request), {workspaceId} = await params;
  return ok({invitations:await listInvitations(session.userId,workspaceId)});
}); }
export async function POST(request:Request,{params}:Context) { return handle(async () => {
  requireSameOrigin(request);
  const session = await requestSession(request), {workspaceId} = await params, input = await body(request);
  const invite = await createInvitation(session.userId,workspaceId,input.email,input.role);
  await deliverLocalMail(invite.email,`Invitation to ${invite.workspace_name}`,`${process.env.APP_BASE_URL}/invite?token=${invite.token}`);
  return ok({invitation:{id:invite.id,email:invite.email,intended_role:invite.intendedRole}},201);
}); }
