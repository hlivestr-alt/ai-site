import { createWorkspace, listWorkspaces } from "@/lib/workspaces";
import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";

export async function GET(request: Request) { return handle(async () => {
  const session = await requestSession(request);
  return ok({workspaces:await listWorkspaces(session.userId)});
}); }

export async function POST(request: Request) { return handle(async () => {
  requireSameOrigin(request);
  const session = await requestSession(request), input = await body(request);
  const workspace = await createWorkspace(session.userId,input.name);
  return ok({workspace},201);
}); }
