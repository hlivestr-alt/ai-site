import {clipperDetail} from "@/lib/clipper";import {handle,ok,requestSession} from "@/lib/http";
type Context={params:Promise<{workspaceId:string;jobId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const {workspaceId,jobId}=await params;return ok(await clipperDetail(await requestSession(request),workspaceId,jobId));});}
