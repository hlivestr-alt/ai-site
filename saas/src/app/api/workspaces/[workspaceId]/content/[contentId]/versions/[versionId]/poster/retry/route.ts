import {retryContentPoster} from "@/lib/content";
import {handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
export async function POST(request:Request,{params}:{params:Promise<{workspaceId:string;contentId:string;versionId:string}>}){return handle(async()=>{requireSameOrigin(request);const {workspaceId,contentId,versionId}=await params;return ok(await retryContentPoster(await requestSession(request),workspaceId,contentId,versionId));});}
