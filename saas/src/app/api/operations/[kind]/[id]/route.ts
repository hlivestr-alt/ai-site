import {handle,ok,requestSession} from '@/lib/http';
import {requireOperator,supportDetail} from '@/lib/operations';
export async function GET(request:Request,{params}:{params:Promise<{kind:string;id:string}>}){return handle(async()=>{requireOperator(await requestSession(request));const {kind,id}=await params;return ok(await supportDetail(kind,id));});}
