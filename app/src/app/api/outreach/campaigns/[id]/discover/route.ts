import { actionError, requireLocalJson } from "@/lib/integrations/outreach/http";
import { nativeAction } from "@/lib/integrations/outreach/write";
import { audit } from "@/lib/audit";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireLocalJson(request);
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid campaign ID");
    await nativeAction(`/api/v1/outreach/campaigns/${id}/discovery-runs`, {});
    await audit("campaign.preview", "accepted", request, { campaignId: id });
    return Response.json({ state: "PREVIEW_READY" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { await audit("campaign.preview", "rejected", request); return actionError(error); }
}
