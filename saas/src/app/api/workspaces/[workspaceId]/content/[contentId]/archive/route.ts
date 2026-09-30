import {archiveContent} from "@/lib/content";
import {handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
export async function POST(request:Request,{params}:{params:Promise<{workspaceId:string;contentId:string}>}){return handle(async()=>{requireSameOrigin(request);const {workspaceId,contentId}=await params;return ok(await archiveContent(await requestSession(request),workspaceId,contentId));});}
