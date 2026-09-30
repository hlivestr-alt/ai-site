import {sourceFinalize} from "@/lib/sources";
import {handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
type Context={params:Promise<{workspaceId:string;sourceId:string}>};
export async function POST(request:Request,{params}:Context){return handle(async()=>{requireSameOrigin(request);const {workspaceId,sourceId}=await params;return ok(await sourceFinalize(await requestSession(request),workspaceId,sourceId));});}
