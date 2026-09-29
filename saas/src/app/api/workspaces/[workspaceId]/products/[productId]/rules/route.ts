import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { updateProductRules } from "@/lib/products";
type Context={params:Promise<{workspaceId:string;productId:string}>};
export async function PATCH(request:Request,{params}:Context){return handle(async()=>{
  requireSameOrigin(request);const session=await requestSession(request),{workspaceId,productId}=await params,input=await body(request);
  return ok({rules:await updateProductRules(session,workspaceId,productId,input)});
});}
