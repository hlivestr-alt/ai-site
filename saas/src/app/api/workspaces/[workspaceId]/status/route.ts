import {handle,ok,requestSession} from '@/lib/http';
import {requireActiveWorkspace} from '@/lib/products';
import {customerServiceStatus} from '@/lib/operations';
import {workspaceLimits,workspaceStorageUsage} from '@/lib/operational-limits';
export async function GET(request:Request,{params}:{params:Promise<{workspaceId:string}>}){return handle(async()=>{const session=await requestSession(request),{workspaceId}=await params;await requireActiveWorkspace(session,workspaceId,'workspace:read');return ok({services:await customerServiceStatus(),limits:await workspaceLimits(workspaceId),storage:await workspaceStorageUsage(workspaceId)});});}
