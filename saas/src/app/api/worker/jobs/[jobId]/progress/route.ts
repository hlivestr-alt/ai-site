import { workerPost } from "@/lib/worker-http";
import { workerProgress } from "@/lib/worker-core";
type Context={params:Promise<{jobId:string}>};
export async function POST(request:Request,{params}:Context){const {jobId}=await params;return workerPost(request,(worker,data)=>workerProgress(worker,jobId,data));}
