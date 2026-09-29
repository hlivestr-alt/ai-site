import { resetPassword } from "@/lib/auth";
import { body, handle, ok, requireSameOrigin } from "@/lib/http";

export async function POST(request: Request) { return handle(async () => {
  requireSameOrigin(request);
  const input = await body(request);
  await resetPassword(String(input.token || ""),input.password);
  return ok({message:"Password changed. Sign in with your new password."});
}); }
