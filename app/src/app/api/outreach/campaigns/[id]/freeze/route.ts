import { actionError, requireLocalJson } from "@/lib/integrations/outreach/http";
import { nativeAction, validateVersion } from "@/lib/integrations/outreach/write";
import { audit } from "@/lib/audit";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireLocalJson(request);
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid campaign ID");
    const version = validateVersion(await request.json());
    const result = await nativeAction(`/api/v1/outreach/campaigns/${id}/freeze`, { version });
    await audit("campaign.freeze", "accepted", request, { campaignId: id });
    return Response.json({ id, state: result.state, version: result.version, progress: result.progress }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { await audit("campaign.freeze", "rejected", request); return actionError(error); }
}
