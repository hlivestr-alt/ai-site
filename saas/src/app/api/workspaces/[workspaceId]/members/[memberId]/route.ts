import { changeMemberRole, removeMember } from "@/lib/workspaces";
import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";

type Context = {params:Promise<{workspaceId:string;memberId:string}>};
export async function PATCH(request:Request,{params}:Context) { return handle(async () => {
  requireSameOrigin(request);
  const session = await requestSession(request), {workspaceId,memberId} = await params, input = await body(request);
  return ok({member:await changeMemberRole(session.userId,workspaceId,memberId,input.role)});
}); }
export async function DELETE(request:Request,{params}:Context) { return handle(async () => {
  requireSameOrigin(request);
  const session = await requestSession(request), {workspaceId,memberId} = await params;
  await removeMember(session.userId,workspaceId,memberId);
  return ok({ok:true});
}); }
