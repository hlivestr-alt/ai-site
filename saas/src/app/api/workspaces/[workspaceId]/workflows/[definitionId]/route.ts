import {workflowDefinitionDetail,updateWorkflowDefinition} from "@/lib/workflows";
import {body,handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
type Context={params:Promise<{workspaceId:string;definitionId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const {workspaceId,definitionId}=await params;return ok(await workflowDefinitionDetail(await requestSession(request),workspaceId,definitionId));});}
export async function PATCH(request:Request,{params}:Context){return handle(async()=>{requireSameOrigin(request);const {workspaceId,definitionId}=await params;return ok({definition:await updateWorkflowDefinition(await requestSession(request),workspaceId,definitionId,await body(request))});});}
