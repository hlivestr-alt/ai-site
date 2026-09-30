import { aiVideoHistory, aiVideoOptions, createAiVideoJob } from "@/lib/ai-video";
import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const session=await requestSession(request),{workspaceId}=await params;return ok({history:await aiVideoHistory(session,workspaceId),options:await aiVideoOptions(session,workspaceId)});});}
export async function POST(request:Request,{params}:Context){return handle(async()=>{requireSameOrigin(request);const session=await requestSession(request),{workspaceId}=await params;const result=await createAiVideoJob(session,workspaceId,await body(request));return ok({job:result},result.existing?200:201);});}
