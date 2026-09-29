import { NextRequest, NextResponse } from "next/server";
import { authConfigured, createSession, SESSION_COOKIE, SESSION_SECONDS, verifyPassword } from "@/lib/auth/session";
import { authEnabled } from "@/lib/auth/config";

const attempts = new Map<string, { count: number; until: number }>();

export async function POST(request: NextRequest) {
  if (!authEnabled()) return NextResponse.json({ user: null, authEnabled: false }, { headers: { "Cache-Control": "no-store" } });
  if (!authConfigured()) return NextResponse.json({ error: "Login is not configured. Contact the platform operator." }, { status: 503 });
  const address = "operator";
  const current = attempts.get(address);
  if (current && current.count >= 5 && current.until > Date.now()) return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  let body: { password?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (typeof body.password !== "string" || body.password.length > 1024 || !verifyPassword(body.password)) {
    const next = current && current.until > Date.now() ? { count: current.count + 1, until: current.until } : { count: 1, until: Date.now() + 15 * 60_000 };
    attempts.set(address, next);
    console.warn("[auth] login rejected");
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }
  attempts.delete(address);
  const response = NextResponse.json({ user: "operator" });
  response.cookies.set(SESSION_COOKIE, await createSession(), { httpOnly: true, sameSite: "strict", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: SESSION_SECONDS });
  response.headers.set("Cache-Control", "no-store");
  console.info("[auth] operator signed in");
  return response;
}
