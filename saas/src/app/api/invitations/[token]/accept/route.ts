import { acceptInvitation, switchWorkspace } from "@/lib/workspaces";
import { handle, ok, requestSession, requireSameOrigin } from "@/lib/http";

type Context = {params:Promise<{token:string}>};
export async function POST(request:Request,{params}:Context) { return handle(async () => {
  requireSameOrigin(request);
  const session = await requestSession(request), {token} = await params;
  const result = await acceptInvitation(session.userId,session.email,token);
  await switchWorkspace(session,result.workspaceId);
  return ok(result);
}); }
