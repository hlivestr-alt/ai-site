import {contentMedia} from "@/lib/content";
import {AppError} from "@/lib/core";
import {handle,ok,requestSession} from "@/lib/http";
export async function GET(request:Request,{params}:{params:Promise<{workspaceId:string;contentId:string;versionId:string}>}){return handle(async()=>{const {workspaceId,contentId,versionId}=await params,q=new URL(request.url).searchParams,kind=q.get("kind")||"preview";if(!["preview","download","poster","source","reference"].includes(kind))throw new AppError(400,"Invalid media request.");return ok(await contentMedia(await requestSession(request),workspaceId,contentId,versionId,kind as "preview"|"download"|"poster"|"source"|"reference",q.get("assetVersionId")||undefined));});}
