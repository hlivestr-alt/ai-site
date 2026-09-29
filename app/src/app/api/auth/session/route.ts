import { cookies } from "next/headers";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { authEnabled } from "@/lib/auth/config";

export async function GET() {
  if (!authEnabled()) return Response.json({ user: null, authEnabled: false }, { headers: { "Cache-Control": "no-store" } });
  const user = (await readSession((await cookies()).get(SESSION_COOKIE)?.value))?.user;
  return Response.json({ user: user ?? null }, { headers: { "Cache-Control": "no-store" } });
}
