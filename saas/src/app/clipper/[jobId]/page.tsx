import {jobWorkflowLineage} from "@/lib/workflows";
import Link from "next/link";
import {Shell} from "@/components/shell";
import {ClipperJobView} from "@/components/clipper-job-view";
import {pageWorkspace} from "@/lib/page";
import {clipperDetail} from "@/lib/clipper";
import {can,type Role} from "@/lib/permissions";
export default async function ClipperDetailPage({params}:{params:Promise<{jobId:string}>}){const {session,workspaces,current}=await pageWorkspace(),{jobId}=await params;const detail=await clipperDetail(session,current.id,jobId);const workflow=await jobWorkflowLineage(session,current.id,jobId);return <Shell user={session} workspaces={workspaces} current={current}><div className="breadcrumb"><Link href="/clipper">Clipper</Link><span>›</span>{jobId.slice(0,8)}</div><div className="page-heading"><h1>Clipping {jobId.slice(0,8)}</h1></div>{workflow&&<p className="notice">Workflow: <Link href={`/workflows/runs/${workflow.runId}`}>{workflow.name}</Link></p>}<ClipperJobView workspaceId={current.id} initial={JSON.parse(JSON.stringify(detail.job))} canCancel={can(current.role as Role,"future:edit")}/></Shell>;}
