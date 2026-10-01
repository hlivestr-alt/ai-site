import {workflowRunAction} from "@/lib/workflows";
import {body,handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
export async function POST(request:Request,{params}:{params:Promise<{workspaceId:string;runId:string}>}){return handle(async()=>{requireSameOrigin(request);const {workspaceId,runId}=await params;return ok(await workflowRunAction(await requestSession(request),workspaceId,runId,"budget",await body(request)));});}
