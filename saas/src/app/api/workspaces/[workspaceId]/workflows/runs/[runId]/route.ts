import {workflowRunDetail} from "@/lib/workflows";
import {handle,ok,requestSession} from "@/lib/http";
export async function GET(request:Request,{params}:{params:Promise<{workspaceId:string;runId:string}>}){return handle(async()=>{const {workspaceId,runId}=await params;return ok(await workflowRunDetail(await requestSession(request),workspaceId,runId));});}
