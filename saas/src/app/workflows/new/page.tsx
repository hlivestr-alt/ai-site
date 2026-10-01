import Link from "next/link";
import {Shell} from "@/components/shell";
import {pageWorkspace} from "@/lib/page";
import {can,type Role} from "@/lib/permissions";
import {WorkflowForm} from "@/components/workflow-form";
import {aiVideoProducts} from "@/lib/ai-video";
import {sourceList} from "@/lib/sources";
import {workflowBudgetLimit} from "@/lib/workflow-templates";
export default async function NewWorkflowPage(){const {session,workspaces,current}=await pageWorkspace();const [products,sources]=await Promise.all([aiVideoProducts(session,current.id),sourceList(session,current.id)]);return <Shell user={session} workspaces={workspaces} current={current}><p className="breadcrumb"><Link href="/workflows">Workflows</Link> / Create</p><div className="page-heading"><div><p className="eyebrow">SAVE A CONTROLLED RECIPE</p><h1>Create workflow</h1></div></div><section className="panel">{can(current.role as Role,"future:edit")?<WorkflowForm workspaceId={current.id} products={products} sources={sources} limit={workflowBudgetLimit().toString()}/>:<p>Read-only workspace access.</p>}</section></Shell>;}
