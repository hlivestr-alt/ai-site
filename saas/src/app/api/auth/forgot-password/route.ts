import { requestPasswordReset } from "@/lib/auth";
import { body, handle, ok, requireSameOrigin } from "@/lib/http";
import { dispatchAuthMail } from "@/lib/auth-mail";

export async function POST(request: Request) { return handle(async () => {
  requireSameOrigin(request);
  const input = await body(request);
  const reset = await requestPasswordReset(input.email);
  dispatchAuthMail(reset);
  return ok({message:"If an active account matches, a recovery link has been queued by email."});
}); }
