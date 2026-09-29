import { login } from "@/lib/auth";
import { body, handle, requireSameOrigin, sessionResponse } from "@/lib/http";

export async function POST(request: Request) { return handle(async () => {
  requireSameOrigin(request);
  const input = await body(request);
  const session = await login({email:input.email,password:input.password});
  return sessionResponse({ok:true},session.raw);
}); }
