import { createVideoJob, listVideoJobs } from "@/lib/integrations/h3-bridge/jobs";
import { sameOrigin } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return Response.json({ jobs: await listVideoJobs() }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ jobs: [], error: "AI Videos is unavailable" }, { status: 503 }); }
}
export async function POST(request: Request) {
  await audit("h3.request", "attempt", request);
  if (!sameOrigin(request)) { await audit("h3.request", "rejected", request); return Response.json({ error: "Cross-origin request rejected" }, { status: 403 }); }
  try { const job = await createVideoJob(await request.formData()); await audit("h3.request", "accepted", request, { jobId: job.id }); return Response.json(job, { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { await audit("h3.request", "rejected", request); return Response.json({ error: error instanceof Error ? error.message : "Video request failed" }, { status: 400 }); }
}
