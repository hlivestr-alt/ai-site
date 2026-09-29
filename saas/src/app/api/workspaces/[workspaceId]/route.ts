import { renameWorkspace, requireMembership } from "@/lib/workspaces";
import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";

type Context = { params: Promise<{workspaceId:string}> };
export async function GET(request: Request,{params}:Context) { return handle(async () => {
  const session = await requestSession(request), {workspaceId} = await params;
  const membership = await requireMembership(session.userId,workspaceId);
  return ok({workspace:{id:workspaceId,name:membership.workspace_name,role:membership.role}});
}); }
export async function PATCH(request: Request,{params}:Context) { return handle(async () => {
  requireSameOrigin(request);
  const session = await requestSession(request), {workspaceId} = await params, input = await body(request);
  return ok({workspace:await renameWorkspace(session.userId,workspaceId,input.name)});
}); }
