import Link from "next/link";
import {Shell} from "@/components/shell";
import {pageWorkspace} from "@/lib/page";
import {can,type Role} from "@/lib/permissions";
import {workflowDefinitionDetail} from "@/lib/workflows";
import {WorkflowForm} from "@/components/workflow-form";
import {aiVideoProducts} from "@/lib/ai-video";
import {sourceList} from "@/lib/sources";
import {workflowBudgetLimit} from "@/lib/workflow-templates";
export default async function EditWorkflowPage({params}:{params:Promise<{definitionId:string}>}){const {session,workspaces,current}=await pageWorkspace();const {definitionId}=await params;const [data,products,sources]=await Promise.all([workflowDefinitionDetail(session,current.id,definitionId),aiVideoProducts(session,current.id),sourceList(session,current.id)]);const v=data.versions.find(v=>v.id===data.definition.current_version_id)!;return <Shell user={session} workspaces={workspaces} current={current}><p className="breadcrumb"><Link href={`/workflows/${definitionId}`}>{data.definition.name}</Link> / Edit</p><div className="page-heading"><div><h1>Edit workflow</h1><p>Saving creates a new immutable version. Existing runs retain their original inputs.</p></div></div><section className="panel">{can(current.role as Role,"future:edit")&&data.definition.status!=="ARCHIVED"?<WorkflowForm workspaceId={current.id} products={products} sources={sources} limit={workflowBudgetLimit().toString()} initial={{id:definitionId,versionId:v.id,name:data.definition.name,configuration:v.configuration}}/>:<p>Read-only or archived workflow.</p>}</section></Shell>;}
