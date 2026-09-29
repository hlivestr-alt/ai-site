import { switchWorkspace } from "@/lib/workspaces";
import { handle, ok, requestSession, requireSameOrigin } from "@/lib/http";

type Context = {params:Promise<{workspaceId:string}>};
export async function POST(request:Request,{params}:Context) { return handle(async () => {
  requireSameOrigin(request);
  const session = await requestSession(request), {workspaceId} = await params;
  return ok(await switchWorkspace(session,workspaceId));
}); }
