import { workerPost } from "@/lib/worker-http";
import { workerClaim } from "@/lib/worker-core";
export async function POST(request:Request){return workerPost(request,worker=>workerClaim(worker));}
