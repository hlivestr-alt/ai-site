import "server-only";
import {randomUUID} from "node:crypto";
import {query,transaction,type DbClient} from "./db";
import {AppError,audit,isUuid} from "./core";
import {requireActiveWorkspace,getProductSnapshot} from "./products";
import {requireRole} from "./workspaces";
import {frozenProductFromSnapshot} from "./jobs";
import {scopedSource} from "./sources";
import {parseAiVideoRequest,prepareAiVideoInput} from "./video-operation";
import {clipperRequest} from "./clipper-core";
import {prepareClipperInput} from "./clipper-operation";
import {canonicalHash,createQuote} from "./billing-core";
import {workflowTemplate,workflowBudget,runRequest,type WorkflowConfiguration,type WorkflowSnapshot} from "./workflow-templates";
import {workflowEvent,workflowTotals,terminalRun,type RunRow} from "./workflow-core";
import type {Session} from "./auth";
import {checkWorkflowQuota} from './operational-limits';
import {featureEnabled} from './operational-config';

type Definition={id:string;workspace_id:string;name:string;status:string;current_version_id:string;created_at:Date;updated_at:Date};
type DefinitionVersion={id:string;workspace_id:string;workflow_definition_id:string;version_number:number;template_key:string;template_version:1;configuration:WorkflowConfiguration;created_at:Date};
async function scopedDefinition(db:DbClient,workspaceId:string,id:string,lock=false){if(!isUuid(id))throw new AppError(404,"Workflow definition not found.");const r=(await db.query<Definition>(`SELECT * FROM workflow_definitions WHERE workspace_id=$1 AND id=$2 ${lock?"FOR UPDATE":""}`,[workspaceId,id])).rows[0];if(!r)throw new AppError(404,"Workflow definition not found.");return r;}
async function scopedRun(db:DbClient,workspaceId:string,id:string,lock=false){if(!isUuid(id))throw new AppError(404,"Workflow run not found.");const r=(await db.query<RunRow>(`SELECT * FROM workflow_runs WHERE workspace_id=$1 AND id=$2 ${lock?"FOR UPDATE":""}`,[workspaceId,id])).rows[0];if(!r)throw new AppError(404,"Workflow run not found.");return r;}
function definitionRequest(raw:Record<string,unknown>){
  if(typeof raw.name!=="string"||!raw.name.trim()||raw.name.trim().length>160||/[\x00-\x1f]/.test(raw.name)||raw.status!==undefined&&!['ACTIVE','DRAFT'].includes(String(raw.status)))throw new AppError(400,"Enter a workflow name of 1–160 readable characters.");
  const template=workflowTemplate(raw.templateKey);return {name:raw.name.trim(),status:String(raw.status||"ACTIVE"),template,configuration:template.validateDefinition(raw.configuration)};
}
async function prepare(db:DbClient,session:Session,workspaceId:string,configuration:WorkflowConfiguration){
  let product;
  if(configuration.productId){const snapshot=await getProductSnapshot(session,workspaceId,configuration.productId,db);if(snapshot.product.status!=="ACTIVE")throw new AppError(409,"Select an active Product.");product=frozenProductFromSnapshot(snapshot);}
  if(configuration.kind==="PRODUCT_AI_VIDEO_REVIEW_V1"){
    const prepared=[];for(const prompt of configuration.scripts)prepared.push(await prepareAiVideoInput(db,parseAiVideoRequest({...configuration,prompt,quantity:1,idempotencyKey:"workflow-snapshot"}),product!));return prepared;
  }
  const source=await scopedSource(db,workspaceId,configuration.sourceAssetId,true);if(!["UPLOADED","VERIFIED"].includes(source.status))throw new AppError(409,"Finalize the source before starting a workflow.");
  return [prepareClipperInput(clipperRequest({...configuration,idempotencyKey:"workflow-snapshot"}),source,product?{...product,assets:[]}:undefined)];
}
export async function workflowEstimate(session:Session,workspaceId:string,raw:Record<string,unknown>){
  await requireActiveWorkspace(session,workspaceId,"future:spend");const template=workflowTemplate(raw.templateKey),configuration=template.validateDefinition(raw.configuration);
  return transaction(async db=>{await requireRole(session.userId,workspaceId,"future:spend",db);const prepared=await prepare(db,session,workspaceId,configuration),quotes=[];let total=BigInt(0);
    for(const input of prepared){const q=await createQuote(db,workspaceId,session.userId,input.kind,input,canonicalHash(input));const count=configuration.kind==="PRODUCT_AI_VIDEO_REVIEW_V1"?configuration.videosPerScript:1;total+=BigInt(q.tokenAmount)*BigInt(count);quotes.push({operation:q.operation,tokenAmount:q.tokenAmount,childCount:count,priceLabel:q.priceLabel,priceVersionId:q.priceVersionId});}
    return {label:"Estimated using current pricing",estimatedTokens:total.toString(),intendedChildren:configuration.kind==="PRODUCT_AI_VIDEO_REVIEW_V1"?configuration.scripts.length*configuration.videosPerScript:1,quotes,budgetFits:total<=BigInt(configuration.maxTokens),maxTokens:configuration.maxTokens};
  });
}
export async function createWorkflowDefinition(session:Session,workspaceId:string,raw:Record<string,unknown>){
  await requireActiveWorkspace(session,workspaceId,"future:edit");const input=definitionRequest(raw);
  return transaction(async db=>{await requireRole(session.userId,workspaceId,"future:edit",db);await prepare(db,session,workspaceId,input.configuration);const id=randomUUID(),versionId=randomUUID();
    await db.query("INSERT INTO workflow_definitions(id,workspace_id,name,status,created_by) VALUES($1,$2,$3,$4,$5)",[id,workspaceId,input.name,input.status,session.userId]);
    await db.query("INSERT INTO workflow_definition_versions(id,workspace_id,workflow_definition_id,version_number,template_key,template_version,configuration,created_by) VALUES($1,$2,$3,1,$4,1,$5::jsonb,$6)",[versionId,workspaceId,id,input.template.key,JSON.stringify(input.configuration),session.userId]);
    await db.query("UPDATE workflow_definitions SET current_version_id=$1 WHERE workspace_id=$2 AND id=$3",[versionId,workspaceId,id]);await audit(db,{workspaceId,actorUserId:session.userId,type:"WORKFLOW_DEFINITION_CREATED",targetType:"workflow_definition",targetId:id});return {id,versionId,versionNumber:1};
  });
}
export async function updateWorkflowDefinition(session:Session,workspaceId:string,id:string,raw:Record<string,unknown>){
  await requireActiveWorkspace(session,workspaceId,"future:edit");const input=definitionRequest(raw);
  return transaction(async db=>{await requireRole(session.userId,workspaceId,"future:edit",db);const definition=await scopedDefinition(db,workspaceId,id,true);if(definition.status==="ARCHIVED")throw new AppError(409,"Archived workflows cannot be edited.");if(raw.expectedVersionId!==definition.current_version_id)throw new AppError(409,"Workflow changed. Refresh before editing.");
    await prepare(db,session,workspaceId,input.configuration);const prior=(await db.query<{version_number:number}>("SELECT version_number FROM workflow_definition_versions WHERE workspace_id=$1 AND workflow_definition_id=$2 AND id=$3",[workspaceId,id,definition.current_version_id])).rows[0],versionId=randomUUID(),number=prior.version_number+1;
    await db.query("INSERT INTO workflow_definition_versions(id,workspace_id,workflow_definition_id,version_number,template_key,template_version,configuration,created_by) VALUES($1,$2,$3,$4,$5,1,$6::jsonb,$7)",[versionId,workspaceId,id,number,input.template.key,JSON.stringify(input.configuration),session.userId]);
    await db.query("UPDATE workflow_definitions SET name=$1,status=$2,current_version_id=$3,updated_at=now() WHERE workspace_id=$4 AND id=$5",[input.name,input.status,versionId,workspaceId,id]);await audit(db,{workspaceId,actorUserId:session.userId,type:"WORKFLOW_DEFINITION_UPDATED",targetType:"workflow_definition",targetId:id,metadata:{versionNumber:number}});return {id,versionId,versionNumber:number};
  });
}
export async function archiveWorkflowDefinition(session:Session,workspaceId:string,id:string){await requireActiveWorkspace(session,workspaceId,"future:edit");return transaction(async db=>{await requireRole(session.userId,workspaceId,"future:edit",db);const d=await scopedDefinition(db,workspaceId,id,true);if(d.status!=="ARCHIVED"){await db.query("UPDATE workflow_definitions SET status='ARCHIVED',archived_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2",[workspaceId,id]);await audit(db,{workspaceId,actorUserId:session.userId,type:"WORKFLOW_DEFINITION_ARCHIVED",targetType:"workflow_definition",targetId:id});}return {id,status:"ARCHIVED"};});}
export async function startWorkflowRun(session:Session,workspaceId:string,definitionId:string,raw:Record<string,unknown>){
  await requireActiveWorkspace(session,workspaceId,"future:spend");const request=runRequest(raw),hash=canonicalHash({definitionId,versionId:request.versionId||null,maxTokens:request.maxTokens||null});
  return transaction(async db=>{await requireRole(session.userId,workspaceId,"future:spend",db);
    // Serialize same workspace request keys without reserving the wallet or admitting children.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,8))",[`${workspaceId}:${request.key}`]);
    const prior=(await db.query<{id:string;request_hash:string}>("SELECT id,request_hash FROM workflow_runs WHERE workspace_id=$1 AND request_key=$2",[workspaceId,request.key])).rows[0];if(prior){if(prior.request_hash!==hash)throw new AppError(409,"Workflow start key was already used for different input.");return {id:prior.id,existing:true};}
    if(!featureEnabled('WORKFLOWS'))throw new AppError(503,'Workflows are temporarily unavailable.');
    await checkWorkflowQuota(db,workspaceId);
    const definition=await scopedDefinition(db,workspaceId,definitionId,true);if(definition.status!=="ACTIVE")throw new AppError(409,"Only active workflow definitions can start runs.");
    const version=(await db.query<DefinitionVersion>("SELECT * FROM workflow_definition_versions WHERE workspace_id=$1 AND workflow_definition_id=$2 AND id=$3",[workspaceId,definitionId,request.versionId||definition.current_version_id])).rows[0];if(!version)throw new AppError(404,"Workflow version not found.");
    const template=workflowTemplate(version.template_key),configuration=template.validateDefinition(version.configuration),maxTokens=request.maxTokens||configuration.maxTokens;
    const snapshot:WorkflowSnapshot={schemaVersion:1,definitionName:definition.name,definitionVersionId:version.id,templateKey:template.key,templateVersion:1,configuration,prepared:await prepare(db,session,workspaceId,configuration),initialMaxTokens:maxTokens};
    const id=randomUUID();await db.query("INSERT INTO workflow_runs(id,workspace_id,definition_id,definition_version_id,template_key,template_version,input_snapshot,max_tokens,request_key,request_hash,created_by) VALUES($1,$2,$3,$4,$5,1,$6::jsonb,$7,$8,$9,$10)",[id,workspaceId,definitionId,version.id,template.key,JSON.stringify(snapshot),maxTokens,request.key,hash,session.userId]);
    const stepIds=new Map<string,string>();for(const [ordinal,step] of template.planSteps(snapshot).entries()){const stepId=randomUUID();stepIds.set(step.key,stepId);await db.query("INSERT INTO workflow_steps(id,workspace_id,workflow_run_id,step_key,step_type,parent_step_id,ordinal,state,input_snapshot,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,CASE WHEN $8='SUCCEEDED' THEN now() END,CASE WHEN $8='SUCCEEDED' THEN now() END)",[stepId,workspaceId,id,step.key,step.type,step.parentKey?stepIds.get(step.parentKey):null,ordinal,step.state,JSON.stringify(step.input)]);}
    await workflowEvent(db,{workspace_id:workspaceId,id},"WORKFLOW_CREATED",null,{definitionVersionId:version.id,intendedChildren:template.intendedChildren(snapshot).length});
    await audit(db,{workspaceId,actorUserId:session.userId,type:"WORKFLOW_RUN_CREATED",targetType:"workflow_run",targetId:id});await audit(db,{workspaceId,actorUserId:session.userId,type:"WORKFLOW_RUN_STARTED",targetType:"workflow_run",targetId:id});return {id,existing:false};
  });
}
export async function workflowRunAction(session:Session,workspaceId:string,id:string,action:"pause"|"resume"|"cancel"|"budget",raw:Record<string,unknown>={}){
  await requireActiveWorkspace(session,workspaceId,action==="budget"?"future:spend":"future:edit");
  return transaction(async db=>{await requireRole(session.userId,workspaceId,action==="budget"?"future:spend":"future:edit",db);const run=await scopedRun(db,workspaceId,id,true);if(terminalRun(run.status))throw new AppError(409,"This workflow has finished.");if(run.cancel_requested_at&&action!=="cancel")throw new AppError(409,"This workflow is cancelling.");
    let event:string;
    if(action==="pause"){if(run.status==="PAUSED"&&!run.failure_code)return {id,status:run.status};await db.query("UPDATE workflow_runs SET status='PAUSED',paused_at=now(),failure_code=NULL,failure_message_safe=NULL,updated_at=now() WHERE id=$1",[id]);event="WORKFLOW_PAUSED";}
    else if(action==="resume"){if(run.status!=="PAUSED")throw new AppError(409,"Only a paused workflow can be resumed.");await db.query("UPDATE workflow_runs SET status='RUNNING',paused_at=NULL,failure_code=NULL,failure_message_safe=NULL,next_reconcile_at=now(),updated_at=now() WHERE id=$1",[id]);event="WORKFLOW_RESUMED";}
    else if(action==="cancel"){if(run.cancel_requested_at)return {id,cancelRequested:true};await db.query("UPDATE workflow_runs SET cancel_requested_at=now(),next_reconcile_at=now(),updated_at=now() WHERE id=$1",[id]);event="WORKFLOW_CANCELLED";}
    else{const max=workflowBudget(raw.maxTokens);if(BigInt(max)<=BigInt(run.max_tokens))throw new AppError(400,"The new budget must exceed the current budget.");const totals=await workflowTotals(db,workspaceId,id);await db.query("UPDATE workflow_runs SET max_tokens=$1,tokens_committed=$2,status=CASE WHEN failure_code='BUDGET_EXCEEDED' THEN 'RUNNING' ELSE status END,failure_message_safe=CASE WHEN failure_code='BUDGET_EXCEEDED' THEN NULL ELSE failure_message_safe END,failure_code=CASE WHEN failure_code='BUDGET_EXCEEDED' THEN NULL ELSE failure_code END,next_reconcile_at=now(),updated_at=now() WHERE id=$3",[max,totals.committed,id]);event="WORKFLOW_BUDGET_INCREASED";}
    await workflowEvent(db,run,action==="cancel"?"WORKFLOW_CANCEL_REQUESTED":event,null,action==="budget"?{maxTokens:String(raw.maxTokens)}:{});await audit(db,{workspaceId,actorUserId:session.userId,type:event,targetType:"workflow_run",targetId:id,metadata:action==="budget"?{maxTokens:String(raw.maxTokens)}:{}});return {id};
  });
}
export async function workflowDefinitionDetail(session:Session,workspaceId:string,id:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");const definition=await scopedDefinition({query},workspaceId,id),versions=(await query<DefinitionVersion>("SELECT * FROM workflow_definition_versions WHERE workspace_id=$1 AND workflow_definition_id=$2 ORDER BY version_number DESC LIMIT 100",[workspaceId,id])).rows,runs=(await query("SELECT id,status,created_at,finished_at,definition_version_id,max_tokens FROM workflow_runs WHERE workspace_id=$1 AND definition_id=$2 ORDER BY created_at DESC,id DESC LIMIT 50",[workspaceId,id])).rows;return {definition,versions,runs};}
export async function workflowList(session:Session,workspaceId:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");
  const [definitions,runs]=await Promise.all([query(`SELECT d.id,d.name,d.status,d.current_version_id,v.version_number,v.template_key,d.created_at FROM workflow_definitions d JOIN workflow_definition_versions v ON v.workspace_id=d.workspace_id AND v.workflow_definition_id=d.id AND v.id=d.current_version_id WHERE d.workspace_id=$1 ORDER BY d.created_at DESC,d.id DESC LIMIT 100`,[workspaceId]),query(`SELECT r.id,coalesce(r.input_snapshot->>'definitionName',d.name) AS name,r.input_snapshot->'prepared'->0->'product'->'information'->>'name' AS product_name,r.input_snapshot->'prepared'->0->'source'->>'filename' AS source_filename,r.status,r.failure_code,r.cancel_requested_at,r.template_key,r.created_at,r.max_tokens,
    (SELECT count(*) FROM jobs j WHERE j.workspace_id=r.workspace_id AND j.workflow_run_id=r.id) AS admitted,
    (SELECT count(*) FROM jobs j WHERE j.workspace_id=r.workspace_id AND j.workflow_run_id=r.id AND j.status IN ('SUCCEEDED','FAILED','CANCELLED')) AS completed,
    (SELECT coalesce(sum(b.token_amount),0)::text FROM jobs j JOIN job_billing b ON b.workspace_id=j.workspace_id AND b.job_id=j.id WHERE j.workspace_id=r.workspace_id AND j.workflow_run_id=r.id AND b.status IN ('CAPTURED','REFUNDED')) AS spent
    FROM workflow_runs r JOIN workflow_definitions d ON d.workspace_id=r.workspace_id AND d.id=r.definition_id WHERE r.workspace_id=$1 ORDER BY r.created_at DESC,r.id DESC LIMIT 100`,[workspaceId])]);return {definitions:definitions.rows,runs:runs.rows};
}
export async function workflowCounts(session:Session,workspaceId:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");return (await query<{active:string;review:string;funds:string}>("SELECT count(*) FILTER(WHERE status NOT IN ('SUCCEEDED','FAILED','CANCELLED'))::text AS active,count(*) FILTER(WHERE status='WAITING_FOR_REVIEW')::text AS review,count(*) FILTER(WHERE status='WAITING_FOR_FUNDS' OR failure_code='BUDGET_EXCEEDED')::text AS funds FROM workflow_runs WHERE workspace_id=$1",[workspaceId])).rows[0];}
export async function workflowRunDetail(session:Session,workspaceId:string,id:string){
  await requireActiveWorkspace(session,workspaceId,"workspace:read");const run=await scopedRun({query},workspaceId,id),definition=await scopedDefinition({query},workspaceId,run.definition_id);
  const [steps,children,outputs,events,totals]=await Promise.all([
    query<{id:string;step_key:string;step_type:string;state:string;ordinal:number;started_at:Date|null;finished_at:Date|null}>("SELECT id,step_key,step_type,state,ordinal,started_at,finished_at FROM workflow_steps WHERE workspace_id=$1 AND workflow_run_id=$2 ORDER BY ordinal",[workspaceId,id]),
    query<{job_id:string;child_key:string;type:string;status:string;token_amount:string;billing_status:string}>("SELECT c.job_id,c.child_key,j.type,j.status,b.token_amount,b.status AS billing_status FROM workflow_child_jobs c JOIN jobs j ON j.workspace_id=c.workspace_id AND j.id=c.job_id JOIN job_billing b ON b.workspace_id=j.workspace_id AND b.job_id=j.id WHERE c.workspace_id=$1 AND c.workflow_run_id=$2 ORDER BY c.child_key",[workspaceId,id]),
    query<{contentId:string;versionId:string;title:string;status:string;currentVersionId:string;reviewRevision:number}>(`SELECT b.content_item_id AS "contentId",b.content_version_id AS "versionId",i.title,i.status,i.current_version_id AS "currentVersionId",i.review_revision AS "reviewRevision" FROM workflow_review_bindings b JOIN content_items i ON i.workspace_id=b.workspace_id AND i.id=b.content_item_id WHERE b.workspace_id=$1 AND b.workflow_run_id=$2 ORDER BY b.content_version_id`,[workspaceId,id]),
    query("SELECT event_type,safe_data,created_at FROM workflow_events WHERE workspace_id=$1 AND workflow_run_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100",[workspaceId,id]),workflowTotals({query},workspaceId,id)
  ]);
  const config=run.input_snapshot.configuration;
  return {run:{id:run.id,name:run.input_snapshot.definitionName||definition.name,definitionId:run.definition_id,definitionVersionId:run.definition_version_id,templateKey:run.template_key,status:run.status,cancelRequested:!!run.cancel_requested_at,maxTokens:run.max_tokens,failureCode:run.failure_code,failureMessage:run.failure_message_safe,createdAt:run.created_at,startedAt:run.started_at,finishedAt:run.finished_at,result:run.result,intendedChildren:workflowTemplate(run.template_key).intendedChildren(run.input_snapshot).length,productId:config.productId||null,sourceAssetId:config.kind==="SOURCE_CLIPPER_REVIEW_V1"?config.sourceAssetId:null},steps:steps.rows,children:children.rows,outputs:outputs.rows,events:events.rows,budget:{...totals,remaining:(BigInt(run.max_tokens)-BigInt(totals.committed)).toString()}};
}
export type WorkflowRunDetail=Awaited<ReturnType<typeof workflowRunDetail>>;
export async function jobWorkflowLineage(session:Session,workspaceId:string,jobId:string){await requireActiveWorkspace(session,workspaceId,"workspace:read");return (await query<{runId:string;stepId:string;definitionVersionId:string;name:string}>(`SELECT r.id AS "runId",j.workflow_step_id AS "stepId",r.definition_version_id AS "definitionVersionId",d.name FROM jobs j JOIN workflow_runs r ON r.workspace_id=j.workspace_id AND r.id=j.workflow_run_id JOIN workflow_definitions d ON d.workspace_id=r.workspace_id AND d.id=r.definition_id WHERE j.workspace_id=$1 AND j.id=$2`,[workspaceId,jobId])).rows[0]||null;}
