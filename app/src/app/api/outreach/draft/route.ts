import { actionError, requireLocalJson } from "@/lib/integrations/outreach/http";
import { nativeAction, validateDraft } from "@/lib/integrations/outreach/write";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  try {
    requireLocalJson(request);
    const input = validateDraft(await request.json());
    const result = await nativeAction("/api/v1/outreach/campaigns", input);
    await audit("campaign.create", "accepted", request, { campaignId: result.id, count: input.targetCount });
    return Response.json({ id: result.id, state: result.state, version: result.version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { await audit("campaign.create", "rejected", request); return actionError(error); }
}
