import { body, handle, ok, requestSession, requireSameOrigin } from '@/lib/http';
import { recoverCampaign } from '@/lib/outreach';
type Context = {
    params: Promise<{
        workspaceId: string;
    }>;
};
export async function POST(request: Request, { params }: Context) { return handle(async () => { requireSameOrigin(request); const session = await requestSession(request), p = await params; return ok({ campaign: await recoverCampaign(session, p.workspaceId, await body(request)) }); }); }
