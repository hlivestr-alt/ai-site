import { body, handle, ok, requestSession, requireSameOrigin } from '@/lib/http';
import { AppError } from '@/lib/core';
import { controlCampaign } from '@/lib/outreach';
type Context = {
    params: Promise<{
        workspaceId: string;
        campaignId: string;
    }>;
};
export async function POST(request: Request, { params }: Context) { return handle(async () => { requireSameOrigin(request); const session = await requestSession(request), p = await params, raw = await body(request); if (Object.keys(raw).length !== 1 || typeof raw.action !== 'string')
    throw new AppError(400, 'Choose a campaign action.'); return ok({ campaign: await controlCampaign(session, p.workspaceId, p.campaignId, raw.action) }); }); }
