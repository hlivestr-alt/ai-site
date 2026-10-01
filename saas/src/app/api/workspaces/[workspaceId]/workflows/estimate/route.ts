import {workflowEstimate} from "@/lib/workflows";
import {body,handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
export async function POST(request:Request,{params}:{params:Promise<{workspaceId:string}>}){return handle(async()=>{requireSameOrigin(request);const {workspaceId}=await params;return ok({estimate:await workflowEstimate(await requestSession(request),workspaceId,await body(request))});});}
