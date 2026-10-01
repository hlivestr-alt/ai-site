import { register } from "@/lib/auth";
import { safeNext } from "@/lib/core";
import { body, handle, ok, requireSameOrigin } from "@/lib/http";
import { deliverLocalMail } from "@/lib/mail";

export async function POST(request: Request) { return handle(async () => {
  requireSameOrigin(request);
  const input = await body(request);
  const created = await register({ email: input.email, displayName: input.displayName, password: input.password });
  const next = safeNext(input.next);
  const link = `${process.env.APP_BASE_URL}/verify?token=${created.verifyToken}&next=${encodeURIComponent(next)}`;
  await deliverLocalMail(created.email,"Verify your account",link);
  return ok({message:"Account created. Check your email to verify your account."},201);
}); }
