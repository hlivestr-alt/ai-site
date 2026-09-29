import { handle,ok,requestSession,requireSameOrigin } from "@/lib/http";
import { customerCancelJob } from "@/lib/jobs";
type Context={params:Promise<{workspaceId:string;jobId:string}>};
export async function POST(request:Request,{params}:Context){return handle(async()=>{
  requireSameOrigin(request);const session=await requestSession(request),{workspaceId,jobId}=await params;
  return ok(await customerCancelJob(session,workspaceId,jobId));
});}
