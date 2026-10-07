import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { campaignList, sendCampaign } from "@/lib/outreach";
type Context = {
    params: Promise<{
        workspaceId: string;
    }>;
};
export async function GET(request: Request, { params }: Context) { return handle(async () => { const session = await requestSession(request), p = await params; return ok({ campaigns: await campaignList(session, p.workspaceId) }); }); }
export async function POST(request: Request, { params }: Context) { return handle(async () => { requireSameOrigin(request); const session = await requestSession(request), p = await params; return ok({ campaign: await sendCampaign(session, p.workspaceId, await body(request)) }, 201); }); }
