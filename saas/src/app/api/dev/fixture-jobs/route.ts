import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { AppError } from "@/lib/core";
import { createDiagnosticJob, requireDiagnosticToken } from "@/lib/jobs";

export async function POST(request:Request){return handle(async()=>{
  requireSameOrigin(request);requireDiagnosticToken(request.headers.get("x-diagnostic-token"));
  const session=await requestSession(request),data=await body(request);
  if(typeof data.workspaceId!=="string")throw new AppError(400,"Workspace required.");
  const result=await createDiagnosticJob(session,data.workspaceId,data);
  return ok({job:result},result.existing?200:201);
});}
