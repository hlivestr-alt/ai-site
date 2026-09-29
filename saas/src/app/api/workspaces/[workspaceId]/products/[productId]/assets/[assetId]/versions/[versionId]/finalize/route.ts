import { handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { finalizeUpload } from "@/lib/assets";
type Context={params:Promise<{workspaceId:string;productId:string;assetId:string;versionId:string}>};
export async function POST(request:Request,{params}:Context){return handle(async()=>{
  requireSameOrigin(request);const session=await requestSession(request),{workspaceId,productId,assetId,versionId}=await params;
  return ok({asset:await finalizeUpload(session,workspaceId,productId,assetId,versionId)});
});}
