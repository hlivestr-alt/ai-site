import {history} from "@/lib/billing";
import {handle,ok,requestSession} from "@/lib/http";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const session=await requestSession(request),{workspaceId}=await params;return ok(await history(session,workspaceId,new URL(request.url).searchParams.get("cursor")||undefined));});}
