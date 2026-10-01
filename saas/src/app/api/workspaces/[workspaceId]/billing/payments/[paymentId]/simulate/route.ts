import {simulatePayment} from "@/lib/billing";
import {body,handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
export async function POST(request:Request,{params}:{params:Promise<{workspaceId:string;paymentId:string}>}){return handle(async()=>{requireSameOrigin(request);const session=await requestSession(request),{workspaceId,paymentId}=await params;return ok(await simulatePayment(session,workspaceId,paymentId,await body(request)));});}
