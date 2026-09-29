import { handle, ok, requestSession } from "@/lib/http";
import { getAuthorizedDownload } from "@/lib/assets";
import { AppError } from "@/lib/core";
type Context={params:Promise<{workspaceId:string;productId:string;assetId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{
  const session=await requestSession(request),{workspaceId,productId,assetId}=await params,url=new URL(request.url);
  const variant=url.searchParams.get("variant")||"original";
  if(variant!=="original"&&variant!=="thumbnail")throw new AppError(400,"Invalid media variant.");
  const expiresSeconds=process.env.APP_ENV==="local"&&url.searchParams.get("testTtl")==="1"?1:60;
  return ok(await getAuthorizedDownload(session,workspaceId,productId,assetId,variant,expiresSeconds));
});}
