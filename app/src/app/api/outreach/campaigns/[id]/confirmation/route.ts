import { getConfirmationSummary, QueueError } from "@/lib/integrations/outreach/queue";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json(await getConfirmationSummary((await context.params).id), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof QueueError ? error.message : "Campaign confirmation is unavailable." }, { status: error instanceof QueueError ? error.status : 503 }); }
}
