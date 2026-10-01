import {billingSummary} from "@/lib/billing";
import {handle,ok,requestSession} from "@/lib/http";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const session=await requestSession(request),{workspaceId}=await params;return ok({wallet:await billingSummary(session,workspaceId)});});}
