import {clipperArtifactDownload} from "@/lib/clipper";import {handle,ok,requestSession} from "@/lib/http";
type Context={params:Promise<{workspaceId:string;jobId:string;artifactId:string}>};
export async function GET(request:Request,{params}:Context){return handle(async()=>{const {workspaceId,jobId,artifactId}=await params;return ok(await clipperArtifactDownload(await requestSession(request),workspaceId,jobId,artifactId,new URL(request.url).searchParams.get("download")==="1"));});}
