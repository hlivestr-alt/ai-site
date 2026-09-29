import { invitationPreview } from "@/lib/workspaces";
import { handle, ok } from "@/lib/http";

type Context = {params:Promise<{token:string}>};
export async function GET(_request:Request,{params}:Context) { return handle(async () => {
  const {token} = await params;
  return ok({invitation:await invitationPreview(token)});
}); }
