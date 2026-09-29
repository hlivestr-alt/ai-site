import { handle,ok,requestSession } from "@/lib/http";
import { customerJobDetail } from "@/lib/jobs";
type Context={params:Promise<{workspaceId:string;jobId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{
  const session=await requestSession(request),{workspaceId,jobId}=await params;
  return ok(await customerJobDetail(session,workspaceId,jobId));
});}
