import {handle,ok,requestSession} from '@/lib/http';
import {readiness,readinessToken,requireOperator} from '@/lib/operations';
export async function GET(request:Request){return handle(async()=>{if(!readinessToken(request.headers.get('authorization')))requireOperator(await requestSession(request));const result=await readiness();return ok(result,result.ready?200:503);});}
