import { workerPost } from "@/lib/worker-http";
import { workerComplete } from "@/lib/worker-core";
type Context={params:Promise<{jobId:string}>};
export async function POST(request:Request,{params}:Context){const {jobId}=await params;return workerPost(request,(worker,data)=>workerComplete(worker,jobId,data));}
