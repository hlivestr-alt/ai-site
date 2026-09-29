import { handle, ok, requestSession } from "@/lib/http";
import { getAssetVersions } from "@/lib/assets";
type Context={params:Promise<{workspaceId:string;productId:string;assetId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{
  const session=await requestSession(request),{workspaceId,productId,assetId}=await params;
  return ok({versions:await getAssetVersions(session,workspaceId,productId,assetId)});
});}
