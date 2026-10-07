import {createVariation} from '@/lib/clipper-variations';
import {body,handle,ok,requestSession,requireSameOrigin} from '@/lib/http';
export async function POST(request:Request,{params}:{params:Promise<{workspaceId:string}>}){return handle(async()=>{requireSameOrigin(request);const {workspaceId}=await params;const job=await createVariation(await requestSession(request),workspaceId,await body(request));return ok({job},job.existing?200:201);});}
