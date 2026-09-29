import { handle, ok, requestSession } from "@/lib/http";
import { currentWorkspace, listWorkspaces } from "@/lib/workspaces";

export async function GET(request: Request) { return handle(async () => {
  const session = await requestSession(request);
  const workspaces = await listWorkspaces(session.userId);
  return ok({user:{id:session.userId,email:session.email,displayName:session.displayName},workspaces,currentWorkspace:await currentWorkspace(session)});
}); }
