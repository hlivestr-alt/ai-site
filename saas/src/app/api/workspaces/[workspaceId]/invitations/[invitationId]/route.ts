import { cancelInvitation, getInvitation } from "@/lib/workspaces";
import { handle, ok, requestSession, requireSameOrigin } from "@/lib/http";

type Context = {params:Promise<{workspaceId:string;invitationId:string}>};
export async function GET(request:Request,{params}:Context) { return handle(async () => {
  const session = await requestSession(request), {workspaceId,invitationId} = await params;
  return ok({invitation:await getInvitation(session.userId,workspaceId,invitationId)});
}); }
export async function DELETE(request:Request,{params}:Context) { return handle(async () => {
  requireSameOrigin(request);
  const session = await requestSession(request), {workspaceId,invitationId} = await params;
  await cancelInvitation(session.userId,workspaceId,invitationId);
  return ok({ok:true});
}); }
