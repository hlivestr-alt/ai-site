import { handle, ok, requestSession } from "@/lib/http";
import { listProductAssets } from "@/lib/assets";
type Context={params:Promise<{workspaceId:string;productId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{
  const session=await requestSession(request),{workspaceId,productId}=await params,url=new URL(request.url);
  return ok(await listProductAssets(session,workspaceId,productId,Number(url.searchParams.get("page")||1)));
});}
