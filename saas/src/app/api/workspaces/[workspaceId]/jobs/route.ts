import { handle,ok,requestSession } from "@/lib/http";
import { customerJobList } from "@/lib/jobs";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{
  const session=await requestSession(request),{workspaceId}=await params,url=new URL(request.url);
  return ok(await customerJobList(session,workspaceId,{status:url.searchParams.get("status")||undefined,page:Number(url.searchParams.get("page")||1)}));
});}
