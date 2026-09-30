import { AppError } from "@/lib/core";
import { aiVideoOptions, createAiVideoJob, diagnosticVideoScenario } from "@/lib/ai-video";
import { requireDiagnosticToken } from "@/lib/jobs";
import { body, handle, ok, requestSession, requireSameOrigin } from "@/lib/http";
import { requireRole } from "@/lib/workspaces";
export async function POST(request:Request){return handle(async()=>{
  requireSameOrigin(request);requireDiagnosticToken(request.headers.get("x-diagnostic-token"));
  const session=await requestSession(request),data=await body(request);
  if(typeof data.workspaceId!=="string")throw new AppError(400,"Workspace required.");
  await requireRole(session.userId,data.workspaceId,"team:manage");
  const options=await aiVideoOptions(session,data.workspaceId);
  if(!options.tiers[0].enabled||options.tiers[0].mode!=="SIMULATION")throw new AppError(404,"Diagnostic video provider is unavailable.");
  const result=await createAiVideoJob(session,data.workspaceId,data,diagnosticVideoScenario(data.scenario));
  return ok({job:result},result.existing?200:201);
});}
