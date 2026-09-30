import {clipperHistory,createClipperJob} from "@/lib/clipper";
import {body,handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const {workspaceId}=await params;return ok({history:await clipperHistory(await requestSession(request),workspaceId)});});}
export async function POST(request:Request,{params}:Context){return handle(async()=>{requireSameOrigin(request);const {workspaceId}=await params;const job=await createClipperJob(await requestSession(request),workspaceId,await body(request));return ok({job},job.existing?200:201);});}
