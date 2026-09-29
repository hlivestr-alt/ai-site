import { handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { activateProduct } from "@/lib/products";
type Context={params:Promise<{workspaceId:string;productId:string}>};
export async function POST(request:Request,{params}:Context){return handle(async()=>{
  requireSameOrigin(request);const session=await requestSession(request),{workspaceId,productId}=await params;
  return ok({product:await activateProduct(session,workspaceId,productId)});
});}
