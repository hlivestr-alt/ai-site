import {sourceDownload} from "@/lib/sources";
import {handle,ok,requestSession} from "@/lib/http";
type Context={params:Promise<{workspaceId:string;sourceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const {workspaceId,sourceId}=await params;return ok(await sourceDownload(await requestSession(request),workspaceId,sourceId));});}
