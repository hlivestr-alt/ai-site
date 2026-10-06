import { register } from "@/lib/auth";
import { body, handle, ok, requireSameOrigin } from "@/lib/http";
import { dispatchAuthMail } from "@/lib/auth-mail";

export async function POST(request: Request) { return handle(async () => {
  requireSameOrigin(request);
  const input = await body(request);
  const created = await register({ email: input.email, displayName: input.displayName, password: input.password, next:input.next });
  dispatchAuthMail(created.deliveryId);
  return ok({message:"Check your email. If this account needs verification, a link has been queued. Already verified? Sign in."},201);
}); }
