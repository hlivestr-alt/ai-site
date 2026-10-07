import {workerVariationInputs} from '@/lib/clipper-worker';
import {workerPost} from '@/lib/worker-http';
export async function POST(request:Request,{params}:{params:Promise<{jobId:string}>}){const {jobId}=await params;return workerPost(request,(worker,data)=>workerVariationInputs(worker,jobId,data));}
