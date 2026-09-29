import { requestPasswordReset } from "@/lib/auth";
import { body, handle, ok, requireSameOrigin } from "@/lib/http";
import { deliverLocalMail } from "@/lib/mail";

export async function POST(request: Request) { return handle(async () => {
  requireSameOrigin(request);
  const input = await body(request);
  const reset = await requestPasswordReset(input.email);
  if (reset) await deliverLocalMail(reset.email,"Reset your password",`${process.env.APP_BASE_URL}/reset-password?token=${reset.token}`);
  return ok({message:"If an active account matches, a recovery link is in the local development mailbox."});
}); }
