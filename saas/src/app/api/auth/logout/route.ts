import { logout } from "@/lib/auth";
import { clearSessionResponse, handle, requestSession, requireSameOrigin } from "@/lib/http";

export async function POST(request: Request) { return handle(async () => {
  requireSameOrigin(request);
  const session = await requestSession(request);
  await logout(session);
  return clearSessionResponse({ok:true});
}); }
