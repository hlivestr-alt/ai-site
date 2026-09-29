import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { archiveProduct, getProductDetail, updateProduct } from "@/lib/products";
type Context={params:Promise<{workspaceId:string;productId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{
  const session=await requestSession(request),{workspaceId,productId}=await params;
  const {product,version,rules,versionHistory,ruleHistory,assets}=await getProductDetail(session,workspaceId,productId);
  return ok({product,version,rules,versionHistory,ruleHistory,assets});
});}
export async function PATCH(request:Request,{params}:Context){return handle(async()=>{
  requireSameOrigin(request);const session=await requestSession(request),{workspaceId,productId}=await params,input=await body(request);
  return ok({version:await updateProduct(session,workspaceId,productId,input)});
});}
export async function DELETE(request:Request,{params}:Context){return handle(async()=>{
  requireSameOrigin(request);const session=await requestSession(request),{workspaceId,productId}=await params;
  return ok({product:await archiveProduct(session,workspaceId,productId)});
});}
