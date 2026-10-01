import { NextResponse } from "next/server";
import { AppError } from "./core";
import { getSession, SESSION_COOKIE, type Session } from "./auth";
import {headers} from 'next/headers';
import {randomUUID} from 'node:crypto';
import {rateAuthRequest,rateSensitiveRequest} from './operational-rate-limits';
import {requestContext,operationalLog} from './operational-logging';

export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError(415,"Use application/json.");
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 16_384) throw new AppError(413,"Request is too large.");
  await rateAuthRequest(request);
  let value: unknown;
  const chunks:Uint8Array[]=[];let total=0;const reader=request.body?.getReader();
  if(!reader)throw new AppError(400,'Invalid JSON.');
  try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>16384){await reader.cancel();throw new AppError(413,'Request is too large.');}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError(400,"Invalid JSON."); }
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
  await rateSensitiveRequest(request,session.userId);
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

export function ok(data: unknown, status = 200) { return NextResponse.json(data,{status,headers:{"Cache-Control":"no-store",...(requestContext.getStore()?{'X-Request-Id':requestContext.getStore()!.requestId}:{})}}); }

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  const incoming=await headers().catch(()=>null),requestId=incoming?.get('x-request-id')||randomUUID();
  return requestContext.run({requestId},async()=>{
  try { return await fn(); }
  catch (error) {
    if (error instanceof AppError){const response=ok({error:error.message,code:error.safeCode||`HTTP_${error.status}`,requestId},error.status);if(error.retryAfter)response.headers.set('Retry-After',String(error.retryAfter));return response;}
    if (error && typeof error === "object" && "code" in error && error.code === "23505") return ok({error:"A matching record already exists."},409);
    operationalLog('http','request_error',{code:error instanceof Error ? error.name : 'UNKNOWN'});
    return ok({error:"The request could not be completed.",code:'REQUEST_FAILED',requestId},500);
  }
  });
}
