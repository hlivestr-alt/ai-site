import {contentDetail} from "@/lib/content";
import {handle,ok,requestSession} from "@/lib/http";
export async function GET(request:Request,{params}:{params:Promise<{workspaceId:string;contentId:string}>}){return handle(async()=>{const {workspaceId,contentId}=await params;return ok({content:await contentDetail(await requestSession(request),workspaceId,contentId)});});}
