import { handle, ok, requestSession } from "@/lib/http";
import { recipientMessage } from "@/lib/outreach";
type Context = {
    params: Promise<{
        workspaceId: string;
        campaignId: string;
        recipientId: string;
    }>;
};
export async function GET(request: Request, { params }: Context) { return handle(async () => { const session = await requestSession(request), p = await params; return ok(await recipientMessage(session, p.workspaceId, p.campaignId, p.recipientId)); }); }
