import {jobPublishedContent} from "@/lib/content";
import {scopedJob} from "@/lib/job-core";
import {query} from "@/lib/db";
import {requireActiveWorkspace} from "@/lib/products";
import {handle,ok,requestSession} from "@/lib/http";
export async function GET(request:Request,{params}:{params:Promise<{workspaceId:string;jobId:string}>}){return handle(async()=>{const {workspaceId,jobId}=await params;await requireActiveWorkspace(await requestSession(request),workspaceId,"workspace:read");await scopedJob({query},workspaceId,jobId);return ok({content:await jobPublishedContent(workspaceId,jobId)});});}
