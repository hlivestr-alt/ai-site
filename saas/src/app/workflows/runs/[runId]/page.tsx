import Link from "next/link";
import {Shell} from "@/components/shell";
import {pageWorkspace} from "@/lib/page";
import {can,type Role} from "@/lib/permissions";
import {workflowRunDetail} from "@/lib/workflows";
import {WorkflowRunView} from "@/components/workflow-run-view";
export default async function RunPage({params}:{params:Promise<{runId:string}>}){const {session,workspaces,current}=await pageWorkspace();const {runId}=await params;const detail=await workflowRunDetail(session,current.id,runId);return <Shell user={session} workspaces={workspaces} current={current}><p className="breadcrumb"><Link href="/workflows">Workflows</Link> / <Link href={`/workflows/${detail.run.definitionId}`}>{detail.run.name}</Link> / Run</p><div className="page-heading"><div><p className="eyebrow">BACKGROUND WORKFLOW</p><h1>{detail.run.name}</h1><p>Run {runId.slice(0,8)} · {detail.run.templateKey}</p></div><Link className="button secondary" href="/review">Review Center</Link></div><WorkflowRunView workspaceId={current.id} initial={JSON.parse(JSON.stringify(detail))} canEdit={can(current.role as Role,"future:edit")}/></Shell>;}
