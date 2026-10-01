import {handle,ok,requestSession} from '@/lib/http';
import {requireOperator,operationStatus} from '@/lib/operations';
export async function GET(request:Request){return handle(async()=>{requireOperator(await requestSession(request));const {counters,services,workers,storage,billingMismatchCount,backup,alerts}=await operationStatus();return ok({counters,services,workers,storage,billingMismatchCount,backupAgeSeconds:backup?Math.floor((Date.now()-new Date(backup.completed_at).getTime())/1000):null,alerts});});}
