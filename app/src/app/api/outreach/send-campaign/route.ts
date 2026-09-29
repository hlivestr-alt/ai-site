import { requireLocalJson } from "@/lib/integrations/outreach/http";
import { sendCampaign } from "@/lib/integrations/outreach/send-campaign";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    requireLocalJson(request);
    const body = await request.json() as Record<string, unknown>;
    if (!body || typeof body.key !== "string" || (body.retry !== undefined && typeof body.retry !== "boolean")) throw new Error("Invalid send operation.");
    const result = await sendCampaign(body.key, body.input, body.retry === true);
    if (result.stage === "sending") await audit("campaign.queue", "accepted", request, { campaignId: result.campaignId, count: result.frozen });
    else if (result.stage === "failed" || result.stage === "uncertain") await audit("campaign.queue", "rejected", request, { campaignId: result.campaignId });
    return Response.json({ stage: result.stage, campaignId: result.campaignId, frozen: result.frozen, error: result.error }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await audit("campaign.queue", "rejected", request);
    return Response.json({ error: error instanceof Error ? error.message : "Campaign could not be sent." }, { status: 400 });
  }
}
