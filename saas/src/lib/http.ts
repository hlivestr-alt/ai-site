import { NextResponse } from "next/server";
import { AppError } from "./core";
import { getSession, SESSION_COOKIE, type Session } from "./auth";

export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError(415,"Use application/json.");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 16_384) throw new AppError(413,"Request is too large.");
  let value: unknown;
  try { value = await request.json(); } catch { throw new AppError(400,"Invalid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(400,"Expected a JSON object.");
  return value as Record<string, unknown>;
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== process.env.APP_BASE_URL) throw new AppError(403,"Request origin is not allowed.");
}

function cookieValue(request: Request, key: string): string | undefined {
  const raw = request.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === key) return value.join("=");
  }
  return undefined;
}

export async function requestSession(request: Request): Promise<Session> {
  const session = await getSession(cookieValue(request,SESSION_COOKIE));
  if (!session) throw new AppError(401,"Sign in to continue.");
  return session;
}

export function sessionResponse(data: unknown, raw: string, status = 200) {
  const response = NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
  response.cookies.set(SESSION_COOKIE,raw,{httpOnly:true,sameSite:"lax",secure:process.env.APP_BASE_URL?.startsWith("https://") || false,path:"/",maxAge:14*24*60*60});
  return response;
}

export function clearSessionResponse(data: unknown) {
  const response = NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
  response.cookies.set(SESSION_COOKIE,"",{httpOnly:true,sameSite:"lax",secure:process.env.APP_BASE_URL?.startsWith("https://") || false,path:"/",maxAge:0});
  return response;
}

export function ok(data: unknown, status = 200) { return NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}}); }

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); }
  catch (error) {
    if (error instanceof AppError) return ok({error:error.message},error.status);
    if (error && typeof error === "object" && "code" in error && error.code === "23505") return ok({error:"A matching record already exists."},409);
    console.error("SaaS request failed",error instanceof Error ? error.name : "unknown");
    return ok({error:"The request could not be completed."},500);
  }
}
