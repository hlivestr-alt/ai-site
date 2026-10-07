import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { AppError } from "@/lib/core";
import { reconcileOutreach } from "@/lib/outreach-worker";
type Context = {
    params: Promise<{
        workspaceId: string;
        campaignId: string;
    }>;
};
export async function POST(request: Request, { params }: Context) { return handle(async () => { requireSameOrigin(request); const session = await requestSession(request), p = await params; const raw = await body(request); if (Object.keys(raw).length)
    throw new AppError(400, 'Provider evidence is checked by the server.'); return ok(await reconcileOutreach(session, p.workspaceId, p.campaignId)); }); }
