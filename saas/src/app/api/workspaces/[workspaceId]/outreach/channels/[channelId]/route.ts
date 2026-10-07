import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { AppError } from "@/lib/core";
import { channelDetail, disconnectChannel } from "@/lib/outreach";
type Context = {
    params: Promise<{
        workspaceId: string;
        channelId: string;
    }>;
};
export async function GET(request: Request, { params }: Context) { return handle(async () => { const session = await requestSession(request), p = await params; return ok({ channel: await channelDetail(session, p.workspaceId, p.channelId) }); }); }
export async function POST(request: Request, { params }: Context) { return handle(async () => { requireSameOrigin(request); const session = await requestSession(request), p = await params; const raw = await body(request); if (Object.keys(raw).length !== 1 || raw.action !== 'disconnect')
    throw new AppError(400, 'Unsupported channel action.'); return ok({ channel: await disconnectChannel(session, p.workspaceId, p.channelId) }); }); }
