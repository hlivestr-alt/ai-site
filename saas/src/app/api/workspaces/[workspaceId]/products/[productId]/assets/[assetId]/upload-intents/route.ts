import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { createUploadIntent } from "@/lib/assets";
type Context={params:Promise<{workspaceId:string;productId:string;assetId:string}>};
export async function POST(request:Request,{params}:Context){return handle(async()=>{
  requireSameOrigin(request);const session=await requestSession(request),{workspaceId,productId,assetId}=await params,input=await body(request);
  return ok({intent:await createUploadIntent(session,workspaceId,productId,input,assetId)},201);
});}
