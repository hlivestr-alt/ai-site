import {quoteAiVideo} from "@/lib/ai-video";
import {quoteClipper} from "@/lib/clipper";
import {quoteVariation} from '@/lib/clipper-variations';
import {AppError} from "@/lib/core";
import {body,handle,ok,requestSession,requireSameOrigin} from "@/lib/http";
type Context={params:Promise<{workspaceId:string}>};
export async function POST(request:Request,{params}:Context){return handle(async()=>{requireSameOrigin(request);const session=await requestSession(request),{workspaceId}=await params,raw=await body(request);if(!['AI_VIDEO','CLIPPER','CLIPPER_VARIATION'].includes(String(raw.operation)))throw new AppError(400,"Unsupported operation.");return ok({quote:await (raw.operation==='CLIPPER_VARIATION'?quoteVariation:raw.operation==="AI_VIDEO"?quoteAiVideo:quoteClipper)(session,workspaceId,raw)});});}
