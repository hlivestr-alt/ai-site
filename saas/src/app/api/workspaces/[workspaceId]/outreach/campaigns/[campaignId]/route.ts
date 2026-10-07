import { handle, ok, requestSession } from "@/lib/http";
import { campaignDetail } from "@/lib/outreach";
type Context = {
    params: Promise<{
        workspaceId: string;
        campaignId: string;
    }>;
};
export async function GET(request: Request, { params }: Context) { return handle(async () => { const session = await requestSession(request), p = await params; return ok({ campaign: await campaignDetail(session, p.workspaceId, p.campaignId) }); }); }
