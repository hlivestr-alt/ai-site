import { aiVideoDetail } from "@/lib/ai-video";
import { handle,ok,requestSession } from "@/lib/http";
type Context={params:Promise<{workspaceId:string;jobId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const session=await requestSession(request),{workspaceId,jobId}=await params;return ok(await aiVideoDetail(session,workspaceId,jobId));});}
