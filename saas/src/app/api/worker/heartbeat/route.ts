import { workerPost } from "@/lib/worker-http";
import { workerHeartbeat } from "@/lib/worker-core";
export async function POST(request:Request){return workerPost(request,workerHeartbeat);}
