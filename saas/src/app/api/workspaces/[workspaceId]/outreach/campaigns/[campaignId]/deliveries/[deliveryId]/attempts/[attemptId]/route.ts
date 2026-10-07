import { handle, ok, requestSession } from "@/lib/http";
import { AppError } from "@/lib/core";
import { deliveryDetail } from "@/lib/outreach";
type Context = {
    params: Promise<{
        workspaceId: string;
        campaignId: string;
        deliveryId: string;
        attemptId: string;
    }>;
};
export async function GET(request: Request, { params }: Context) { return handle(async () => { const session = await requestSession(request), p = await params; const delivery = await deliveryDetail(session, p.workspaceId, p.campaignId, p.deliveryId), attempt = delivery.attempts.find(a => a.id === p.attemptId); if (!attempt)
    throw new AppError(404, 'Attempt not found.'); return ok({ attempt }); }); }
