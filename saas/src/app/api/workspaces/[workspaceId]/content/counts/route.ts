import {contentCounts} from "@/lib/content";
import {handle,ok,requestSession} from "@/lib/http";
export async function GET(request:Request,{params}:{params:Promise<{workspaceId:string}>}){return handle(async()=>ok(await contentCounts(await requestSession(request),(await params).workspaceId)));}
