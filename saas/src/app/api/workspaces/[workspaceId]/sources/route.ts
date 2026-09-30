import {sourceList,sourceCreate} from "@/lib/sources";
import {body,handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
type Context={params:Promise<{workspaceId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const {workspaceId}=await params;return ok({sources:await sourceList(await requestSession(request),workspaceId)});});}
export async function POST(request:Request,{params}:Context){return handle(async()=>{requireSameOrigin(request);const {workspaceId}=await params;return ok(await sourceCreate(await requestSession(request),workspaceId,await body(request)),201);});}
