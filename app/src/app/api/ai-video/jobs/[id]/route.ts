import { sameOrigin } from "@/lib/auth/session";
import { getVideoJob, retryWaitingJob } from "@/lib/integrations/h3-bridge/jobs";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json(await getVideoJob((await context.params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Video job unavailable" }, { status: 404 }); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  try { return Response.json(await retryWaitingJob((await context.params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Video job cannot be retried" }, { status: 400 }); }
}
