import { verifyEmailToken } from "@/lib/auth";
import { body, handle, requireSameOrigin, sessionResponse } from "@/lib/http";

export async function POST(request: Request) { return handle(async () => {
  requireSameOrigin(request);
  const input = await body(request);
  const verified = await verifyEmailToken(String(input.token || ""));
  return sessionResponse({ok:true},verified.raw);
}); }
