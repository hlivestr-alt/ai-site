import { requireLocalJson } from "@/lib/integrations/outreach/http";
import { confirmAndQueueCampaign, QueueError } from "@/lib/integrations/outreach/queue";
import { validateVersion } from "@/lib/integrations/outreach/write";
import { audit } from "@/lib/audit";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  await audit("campaign.queue", "attempt", request, { campaignId: id });
  try {
    requireLocalJson(request);
    const input = await request.json() as Record<string, unknown>;
    if (input.confirm !== true) throw new QueueError("Explicit confirmation is required.", 400);
    const version = validateVersion(input);
    const result = await confirmAndQueueCampaign(id, version);
    await audit("campaign.queue", result.alreadyQueued ? "already-queued" : "accepted", request, { campaignId: id, count: result.campaign.frozen });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof QueueError ? error.message : error instanceof Error ? error.message : "Confirmation failed.";
    await audit("campaign.queue", "rejected", request, { campaignId: id });
    return Response.json({ error: message }, { status: error instanceof QueueError ? error.status : 400 });
  }
}
