import { NextRequest, NextResponse } from "next/server";
import { readSession, SESSION_COOKIE, sameOrigin } from "@/lib/auth/session";
import { authEnabled } from "@/lib/auth/config";
import { audit } from "@/lib/audit";

async function auditRejectedWrite(request: NextRequest) {
  if (["GET", "HEAD"].includes(request.method)) return;
  const path = request.nextUrl.pathname;
  const match = /^\/api\/outreach\/campaigns\/([^/]+)\/(confirm|freeze|discover)$/.exec(path);
  if (match) await audit(match[2] === "confirm" ? "campaign.queue" : match[2] === "freeze" ? "campaign.freeze" : "campaign.preview", "rejected", request, { campaignId: match[1] });
  else if (path === "/api/outreach/draft") await audit("campaign.create", "rejected", request);
  else if (path.startsWith("/api/ai-video/jobs")) await audit("h3.request", "rejected", request);
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const enabled = authEnabled();
  const loggedIn = enabled && Boolean(await readSession(request.cookies.get(SESSION_COOKIE)?.value));
  const publicRoute = path === "/login" || path === "/api/auth/login";
  if (enabled && !publicRoute && !loggedIn) {
    await auditRejectedWrite(request);
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Session expired. Please sign in." }, { status: 401 });
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }
  if (request.method !== "GET" && request.method !== "HEAD" && !sameOrigin(request)) {
    await auditRejectedWrite(request);
    return NextResponse.json({ error: "Cross-origin action rejected" }, { status: 403 });
  }
  if (path === "/login" && (!enabled || loggedIn)) return NextResponse.redirect(new URL("/", request.url));
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"] };
