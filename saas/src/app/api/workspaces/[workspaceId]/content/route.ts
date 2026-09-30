import {contentList} from "@/lib/content";
import {handle,ok,requestSession} from "@/lib/http";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const {workspaceId}=await params,q=new URL(request.url).searchParams;return ok(await contentList(await requestSession(request),workspaceId,{type:q.get("type")||undefined,status:q.get("status")||undefined,productId:q.get("productId")||undefined,search:q.get("search")||undefined,page:q.has("page")?Number(q.get("page")):1}));});}
