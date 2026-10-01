import {jobWorkflowLineage} from "@/lib/workflows";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { VideoJobView } from "@/components/video-job-view";
import { pageWorkspace } from "@/lib/page";
import { aiVideoDetail } from "@/lib/ai-video";
export default async function AiVideoDetailPage({params}:{params:Promise<{jobId:string}>}){
  const {session,workspaces,current}=await pageWorkspace(),{jobId}=await params;
  const detail=await aiVideoDetail(session,current.id,jobId);
  const workflow=await jobWorkflowLineage(session,current.id,jobId);
  return <Shell user={session} workspaces={workspaces} current={current}><div className="breadcrumb"><Link href="/ai-videos">AI Videos</Link><span>›</span>Video {jobId.slice(0,8)}</div><div className="page-heading"><div><p className="eyebrow">AI VIDEO JOB</p><h1>Video {jobId.slice(0,8)}</h1><p>Created {new Date(detail.job.createdAt).toLocaleString("en-US",{timeZone:"UTC"})} UTC</p></div></div>{workflow&&<p className="notice">Workflow: <Link href={`/workflows/runs/${workflow.runId}`}>{workflow.name}</Link></p>}<VideoJobView workspaceId={current.id} initial={JSON.parse(JSON.stringify(detail.job))}/></Shell>;
}
