import {createVariantRelation} from "@/lib/content";
import {body,handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
export async function POST(request:Request,{params}:{params:Promise<{workspaceId:string;contentId:string}>}){return handle(async()=>{requireSameOrigin(request);const {workspaceId,contentId}=await params;return ok(await createVariantRelation(await requestSession(request),workspaceId,contentId,await body(request)));});}
