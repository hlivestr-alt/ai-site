import { handle, ok, requestSession } from "@/lib/http";
import { deliveryDetail } from "@/lib/outreach";
type Context = {
    params: Promise<{
        workspaceId: string;
        campaignId: string;
        deliveryId: string;
    }>;
};
export async function GET(request: Request, { params }: Context) { return handle(async () => { const session = await requestSession(request), p = await params; return ok({ delivery: await deliveryDetail(session, p.workspaceId, p.campaignId, p.deliveryId) }); }); }
