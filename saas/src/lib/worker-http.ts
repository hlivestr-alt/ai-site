import { body, handle, ok } from "./http";
import { authenticateWorker } from "./worker-core";

export function workerPost(request:Request,run:(worker:Awaited<ReturnType<typeof authenticateWorker>>,data:Record<string,unknown>)=>Promise<unknown>){
  return handle(async()=>{const worker=await authenticateWorker(request.headers.get("authorization")),data=await body(request);return ok(await run(worker,data));});
}
