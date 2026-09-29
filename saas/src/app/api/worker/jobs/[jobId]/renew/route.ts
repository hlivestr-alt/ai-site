import { workerPost } from "@/lib/worker-http";
import { workerRenew } from "@/lib/worker-core";
type Context={params:Promise<{jobId:string}>};
export async function POST(request:Request,{params}:Context){const {jobId}=await params;return workerPost(request,(worker,data)=>workerRenew(worker,jobId,data));}
