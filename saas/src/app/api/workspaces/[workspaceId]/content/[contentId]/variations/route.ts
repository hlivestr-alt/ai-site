import {variationEditor,variationFamily} from '@/lib/clipper-variations';
import {handle,ok,requestSession} from '@/lib/http';
export async function GET(request:Request,{params}:{params:Promise<{workspaceId:string;contentId:string}>}){return handle(async()=>{const {workspaceId,contentId}=await params,session=await requestSession(request);return ok({editor:await variationEditor(session,workspaceId,contentId),family:await variationFamily(session,workspaceId,contentId)});});}
