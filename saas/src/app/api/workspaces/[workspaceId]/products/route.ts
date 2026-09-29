import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { createProduct, listProducts } from "@/lib/products";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{
  const session=await requestSession(request),{workspaceId}=await params,url=new URL(request.url);
  return ok(await listProducts(session,workspaceId,{search:url.searchParams.get("search")||"",status:url.searchParams.get("status")||"CURRENT",page:Number(url.searchParams.get("page")||1),pageSize:Number(url.searchParams.get("pageSize")||20)}));
});}
export async function POST(request:Request,{params}:Context){return handle(async()=>{
  requireSameOrigin(request);const session=await requestSession(request),{workspaceId}=await params,input=await body(request);
  return ok({product:await createProduct(session,workspaceId,input)},201);
});}
