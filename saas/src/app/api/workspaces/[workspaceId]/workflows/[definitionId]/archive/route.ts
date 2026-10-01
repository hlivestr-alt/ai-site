import {archiveWorkflowDefinition} from "@/lib/workflows";
import {handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
export async function POST(request:Request,{params}:{params:Promise<{workspaceId:string;definitionId:string}>}){return handle(async()=>{requireSameOrigin(request);const {workspaceId,definitionId}=await params;return ok({definition:await archiveWorkflowDefinition(await requestSession(request),workspaceId,definitionId)});});}
