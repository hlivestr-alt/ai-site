import {usage} from "@/lib/billing";
import {handle,ok,requestSession} from "@/lib/http";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const session=await requestSession(request),{workspaceId}=await params;return ok({usage:await usage(session,workspaceId)});});}
