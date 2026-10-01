import {startWorkflowRun} from "@/lib/workflows";
import {body,handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
export async function POST(request:Request,{params}:{params:Promise<{workspaceId:string;definitionId:string}>}){return handle(async()=>{requireSameOrigin(request);const {workspaceId,definitionId}=await params;const run=await startWorkflowRun(await requestSession(request),workspaceId,definitionId,await body(request));return ok({run},run.existing?200:201);});}
