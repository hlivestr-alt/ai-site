import { sameOrigin } from "@/lib/auth/session";

export function requireLocalJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("JSON request required");
  if (!sameOrigin(request)) throw new Error("Cross-origin action rejected");
}

export function actionError(error: unknown) {
  const message = error instanceof Error ? error.message : "Action failed";
  const status = /rejected|unavailable|invalid response/i.test(message) ? 502 : 400;
  return Response.json({ error: message }, { status });
}
