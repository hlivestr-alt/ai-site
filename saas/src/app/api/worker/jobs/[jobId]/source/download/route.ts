import {workerPost} from "@/lib/worker-http";import {workerSourceDownload} from "@/lib/clipper-worker";
type Context={params:Promise<{jobId:string}>};
export async function POST(request:Request,{params}:Context){const {jobId}=await params;return workerPost(request,(worker,data)=>workerSourceDownload(worker,jobId,data));}
