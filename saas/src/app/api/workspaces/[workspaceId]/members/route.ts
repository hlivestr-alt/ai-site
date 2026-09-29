import { members } from "@/lib/workspaces";
import { handle, ok, requestSession } from "@/lib/http";

type Context = {params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context) { return handle(async () => {
  const session = await requestSession(request), {workspaceId} = await params;
  return ok({members:await members(session.userId,workspaceId)});
}); }
