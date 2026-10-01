import {customerCreatePayment,paymentHistory} from "@/lib/billing";
import {body,handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const session=await requestSession(request),{workspaceId}=await params;return ok(await paymentHistory(session,workspaceId,new URL(request.url).searchParams.get("cursor")||undefined));});}
export async function POST(request:Request,{params}:Context){return handle(async()=>{requireSameOrigin(request);const session=await requestSession(request),{workspaceId}=await params;return ok({payment:await customerCreatePayment(session,workspaceId,await body(request))},201);});}
