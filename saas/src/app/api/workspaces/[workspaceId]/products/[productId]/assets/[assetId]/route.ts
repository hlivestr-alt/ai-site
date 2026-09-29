import { handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { archiveAsset, getAssetMetadata } from "@/lib/assets";
type Context={params:Promise<{workspaceId:string;productId:string;assetId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{
  const session=await requestSession(request),{workspaceId,productId,assetId}=await params;
  return ok(await getAssetMetadata(session,workspaceId,productId,assetId));
});}
export async function DELETE(request:Request,{params}:Context){return handle(async()=>{
  requireSameOrigin(request);const session=await requestSession(request),{workspaceId,productId,assetId}=await params;
  return ok({asset:await archiveAsset(session,workspaceId,productId,assetId)});
});}
