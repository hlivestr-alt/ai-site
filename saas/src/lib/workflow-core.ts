import {query,transaction,type DbClient} from "./db";
import {AppError} from "./core";
import {createQuote,billingRealm,lockWallet} from "./billing-core";
import {admitOperation} from "./paid-operations";
import {cancelWorkspaceJob,inputHash} from "./job-core";
import {isContentApproved} from "./content-eligibility";
import {workflowTemplate,type WorkflowSnapshot,type ReviewOutcome} from "./workflow-templates";
import {correlationMetadata} from './operational-logging';

export type RunStatus="QUEUED"|"RUNNING"|"WAITING_FOR_FUNDS"|"WAITING_FOR_REVIEW"|"PAUSED"|"SUCCEEDED"|"FAILED"|"CANCELLED";
export type RunRow={id:string;workspace_id:string;definition_id:string;definition_version_id:string;template_key:string;template_version:number;status:RunStatus;input_snapshot:WorkflowSnapshot;max_tokens:string;tokens_committed:string;request_key:string;request_hash:string;created_by:string;created_at:Date;started_at:Date|null;paused_at:Date|null;finished_at:Date|null;cancel_requested_at:Date|null;failure_code:string|null;failure_message_safe:string|null;result:Record<string,unknown>|null};
export const terminalRun=(status:string)=>["SUCCEEDED","FAILED","CANCELLED"].includes(status);
export async function workflowEvent(db:DbClient,run:Pick<RunRow,"workspace_id"|"id">,type:string,stepId:string|null=null,data:Record<string,string|number|boolean|null>={}){
  if(Buffer.byteLength(JSON.stringify(data))>4096)throw new Error("Workflow event metadata is too large");
  await db.query("INSERT INTO workflow_events(workspace_id,workflow_run_id,workflow_step_id,event_type,safe_data) VALUES($1,$2,$3,$4,$5::jsonb)",[run.workspace_id,run.id,stepId,type,JSON.stringify({...data,...correlationMetadata()})]);
}
// JobBilling is authoritative; REFUNDED retains historical consumption in v1 (no paid reruns).
export async function workflowTotals(db:DbClient,workspaceId:string,runId:string){
  const r=(await db.query<{reserved:string;captured:string;released:string;refunded:string}>(`SELECT
    coalesce(sum(b.token_amount) FILTER(WHERE b.status='RESERVED'),0)::text AS reserved,
    coalesce(sum(b.token_amount) FILTER(WHERE b.status IN ('CAPTURED','REFUNDED')),0)::text AS captured,
    coalesce(sum(b.token_amount) FILTER(WHERE b.status='RELEASED'),0)::text AS released,
    coalesce(sum(b.token_amount) FILTER(WHERE b.status='REFUNDED'),0)::text AS refunded
    FROM jobs j JOIN job_billing b ON b.workspace_id=j.workspace_id AND b.job_id=j.id WHERE j.workspace_id=$1 AND j.workflow_run_id=$2`,[workspaceId,runId])).rows[0];
  return {...r,committed:(BigInt(r.reserved)+BigInt(r.captured)).toString()};
}
async function state(db:DbClient,run:RunRow,status:RunStatus,code:string|null=null,message:string|null=null){
  const changed=run.status!==status||run.failure_code!==code;
  await db.query("UPDATE workflow_runs SET status=$1,failure_code=$2,failure_message_safe=$3,started_at=coalesce(started_at,now()),finished_at=CASE WHEN $1 IN ('SUCCEEDED','FAILED','CANCELLED') THEN now() ELSE NULL END,updated_at=now() WHERE workspace_id=$4 AND id=$5",[status,code,message,run.workspace_id,run.id]);
  if(changed)await workflowEvent(db,run,status==="RUNNING"?(run.status==="QUEUED"?"WORKFLOW_STARTED":"WORKFLOW_RESUMED"):status==="PAUSED"&&code==="BUDGET_EXCEEDED"?"BUDGET_EXCEEDED":status.startsWith("WAITING_")?status:`WORKFLOW_${status}`,null,{code});
  run.status=status;run.failure_code=code;run.failure_message_safe=message;
}
async function stepState(db:DbClient,id:string,value:string,output?:Record<string,unknown>){
  const json=output===undefined?null:JSON.stringify(output);
  return db.query(`UPDATE workflow_steps SET state=$2,output_snapshot=CASE WHEN $3::jsonb IS NULL THEN output_snapshot ELSE $3::jsonb END,
    started_at=CASE WHEN $2 IN ('RUNNING','WAITING','SUCCEEDED','FAILED') THEN coalesce(started_at,now()) ELSE started_at END,
    finished_at=CASE WHEN $2 IN ('SUCCEEDED','FAILED','SKIPPED','CANCELLED') THEN coalesce(finished_at,now()) ELSE NULL END
    WHERE id=$1 AND (state IS DISTINCT FROM $2 OR ($3::jsonb IS NOT NULL AND output_snapshot IS DISTINCT FROM $3::jsonb)) RETURNING id`,[id,value,json]);
}
type Child={step_id:string;step_key:string;step_state:string;review_id:string;job_id:string;status:string;cancel_requested_at:Date|null;billing_status:string;publication_status:string|null};
async function observe(db:DbClient,run:RunRow){
  // Repair a missing mapping using immutable Job lineage, never timestamps or Product guesses.
  const repaired=(await db.query<{job_id:string;workflow_step_id:string}>(`INSERT INTO workflow_child_jobs(workspace_id,workflow_run_id,workflow_step_id,job_id,child_key)
    SELECT j.workspace_id,j.workflow_run_id,j.workflow_step_id,j.id,s.step_key FROM jobs j JOIN workflow_steps s ON s.workspace_id=j.workspace_id AND s.workflow_run_id=j.workflow_run_id AND s.id=j.workflow_step_id
    WHERE j.workspace_id=$1 AND j.workflow_run_id=$2 AND NOT EXISTS(SELECT 1 FROM workflow_child_jobs c WHERE c.job_id=j.id)
    ON CONFLICT DO NOTHING RETURNING job_id,workflow_step_id`,[run.workspace_id,run.id])).rows;
  for(const c of repaired)await workflowEvent(db,run,"CHILD_JOB_LINK_RECOVERED",c.workflow_step_id,{jobId:c.job_id});
  const children=(await db.query<Child>(`SELECT s.id AS step_id,s.step_key,s.state AS step_state,r.id AS review_id,j.id AS job_id,j.status,j.cancel_requested_at,b.status AS billing_status,p.status AS publication_status
    FROM workflow_steps s JOIN jobs j ON j.workspace_id=s.workspace_id AND j.workflow_run_id=s.workflow_run_id AND j.workflow_step_id=s.id
    JOIN workflow_steps r ON r.workspace_id=s.workspace_id AND r.workflow_run_id=s.workflow_run_id AND r.step_key='review:'||s.step_key
    JOIN job_billing b ON b.workspace_id=j.workspace_id AND b.job_id=j.id LEFT JOIN content_publications p ON p.workspace_id=j.workspace_id AND p.job_id=j.id
    WHERE s.workspace_id=$1 AND s.workflow_run_id=$2 ORDER BY s.ordinal`,[run.workspace_id,run.id])).rows;
  for(const child of children){
    if(["FAILED","CANCELLED"].includes(child.status)){
      if((await stepState(db,child.step_id,child.status,{jobId:child.job_id})).rowCount)await workflowEvent(db,run,child.status==="FAILED"?"CHILD_JOB_FAILED":"CHILD_JOB_CANCELLED",child.step_id,{jobId:child.job_id});
      await stepState(db,child.review_id,"SKIPPED");
    }else if(child.status==="SUCCEEDED"&&child.publication_status==="PUBLISHED"&&["CAPTURED","REFUNDED"].includes(child.billing_status)){
      await db.query(`INSERT INTO workflow_review_bindings(workspace_id,workflow_run_id,review_step_id,producer_step_id,content_item_id,content_version_id)
        SELECT v.workspace_id,v.workflow_run_id,$3,v.workflow_step_id,v.content_item_id,v.id FROM content_versions v JOIN jobs j ON j.workspace_id=v.workspace_id AND j.id=v.job_id
        WHERE v.workspace_id=$1 AND v.job_id=$2 AND v.workflow_run_id=$4 AND v.workflow_step_id=$5 AND j.result->'artifactIds' ? v.artifact_id::text ON CONFLICT DO NOTHING`,[run.workspace_id,child.job_id,child.review_id,run.id,child.step_id]);
      const outputs=(await db.query<{contentId:string;versionId:string}>(`SELECT content_item_id AS "contentId",content_version_id AS "versionId" FROM workflow_review_bindings WHERE workspace_id=$1 AND workflow_run_id=$2 AND producer_step_id=$3 ORDER BY content_version_id`,[run.workspace_id,run.id,child.step_id])).rows;
      if((await stepState(db,child.step_id,"SUCCEEDED",{jobId:child.job_id,content:outputs})).rowCount)await workflowEvent(db,run,"CHILD_JOB_SUCCEEDED",child.step_id,{jobId:child.job_id,contentCount:outputs.length});
    }else await stepState(db,child.step_id,child.status==="SUCCEEDED"?"WAITING":"RUNNING",{jobId:child.job_id});
  }
  const bindings=(await db.query<{review_step_id:string;contentId:string;versionId:string;current_version_id:string;status:string;decision:string|null}>(`SELECT b.review_step_id,b.content_item_id AS "contentId",b.content_version_id AS "versionId",i.current_version_id,i.status,d.decision
    FROM workflow_review_bindings b JOIN content_items i ON i.workspace_id=b.workspace_id AND i.id=b.content_item_id
    LEFT JOIN review_decisions d ON d.workspace_id=i.workspace_id AND d.content_item_id=i.id AND d.content_version_id=b.content_version_id AND d.review_revision=i.review_revision
    WHERE b.workspace_id=$1 AND b.workflow_run_id=$2 ORDER BY b.content_version_id`,[run.workspace_id,run.id])).rows;
  const outcomes:ReviewOutcome[]=[];
  for(const b of bindings){
    let decision:ReviewOutcome["decision"]="PENDING";
    if(b.current_version_id!==b.versionId||b.status==="ARCHIVED")decision="UNAVAILABLE";
    else if(await isContentApproved(run.workspace_id,b.contentId,b.versionId,db))decision="APPROVED";
    else if(b.status==="REJECTED"&&b.decision==="REJECT")decision="REJECTED";
    outcomes.push({contentId:b.contentId,versionId:b.versionId,decision});
  }
  for(const reviewId of new Set(bindings.map(b=>b.review_step_id))){
    const own=outcomes.filter((_,i)=>bindings[i].review_step_id===reviewId);
    const s=own.some(o=>o.decision==="UNAVAILABLE")?"FAILED":own.some(o=>o.decision==="PENDING")?"WAITING":"SUCCEEDED";
    await stepState(db,reviewId,s,{content:own});
  }
  return {children,outcomes};
}
async function stopChildren(db:DbClient,run:RunRow,children:Child[],cancel:boolean){
  for(const c of children)if(!["SUCCEEDED","FAILED","CANCELLED"].includes(c.status)&&!c.cancel_requested_at)await cancelWorkspaceJob(db,run.workspace_id,c.job_id);
  await db.query(`UPDATE workflow_steps s SET state=$3,finished_at=now() WHERE s.workspace_id=$1 AND s.workflow_run_id=$2 AND s.step_type IN ('AI_VIDEO','CLIPPER') AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.workspace_id=s.workspace_id AND j.workflow_run_id=s.workflow_run_id AND j.workflow_step_id=s.id) AND s.state NOT IN ('CANCELLED','SKIPPED')`,[run.workspace_id,run.id,cancel?"CANCELLED":"SKIPPED"]);
  await db.query("UPDATE workflow_steps SET state='SKIPPED',finished_at=now() WHERE workspace_id=$1 AND workflow_run_id=$2 AND step_type='REVIEW_GATE' AND state IN ('PENDING','WAITING')",[run.workspace_id,run.id]);
}
export type ReconcileOptions={runId?:string;admissions?:number;fault?:(point:"AFTER_READY"|"AFTER_ADMISSION")=>Promise<void>};
export async function reconcileWorkflowOne(options:ReconcileOptions={}){
  return transaction(async db=>{
    const run=(await db.query<RunRow>(`SELECT * FROM workflow_runs WHERE status NOT IN ('SUCCEEDED','FAILED','CANCELLED') AND ($1::uuid IS NULL OR id=$1) AND ($1::uuid IS NOT NULL OR next_reconcile_at<=now()) ORDER BY next_reconcile_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,[options.runId||null])).rows[0];
    if(!run)return false;
    await db.query("UPDATE workflow_runs SET next_reconcile_at=now()+interval '1 second' WHERE id=$1",[run.id]);
    await lockWallet(db,run.workspace_id);
    const template=workflowTemplate(run.template_key),snapshot=run.input_snapshot;
    const workspace=(await db.query<{status:string}>("SELECT status FROM workspaces WHERE id=$1",[run.workspace_id])).rows[0];
    const {children,outcomes}=await observe(db,run);
    let totals=await workflowTotals(db,run.workspace_id,run.id);
    await db.query("UPDATE workflow_runs SET tokens_committed=$1 WHERE id=$2",[totals.committed,run.id]);
    const failed=children.some(c=>["FAILED","CANCELLED"].includes(c.status));
    if(run.cancel_requested_at||snapshot.configuration.failurePolicy==="FAIL_FAST"&&failed){
      await stopChildren(db,run,children,!!run.cancel_requested_at);
      const unsettled=(await db.query("SELECT j.id FROM jobs j JOIN job_billing b ON b.workspace_id=j.workspace_id AND b.job_id=j.id WHERE j.workspace_id=$1 AND j.workflow_run_id=$2 AND (j.status NOT IN ('SUCCEEDED','FAILED','CANCELLED') OR b.status='RESERVED')",[run.workspace_id,run.id])).rowCount;
      if(!unsettled){const final=run.cancel_requested_at?"CANCELLED":"FAILED";await stepState(db,(await db.query<{id:string}>("SELECT id FROM workflow_steps WHERE workflow_run_id=$1 AND step_key='complete'",[run.id])).rows[0].id,final);await state(db,run,final,run.cancel_requested_at?null:"CHILD_FAILED",run.cancel_requested_at?null:"A required child job failed.");}
      return true;
    }
    if(run.status==="PAUSED"&&run.failure_code!=="BUDGET_EXCEEDED")return true;
    if(workspace?.status!=="ACTIVE"){await state(db,run,"PAUSED","WORKSPACE_UNAVAILABLE","Workspace is unavailable.");return true;}
    if(run.status==="QUEUED")await state(db,run,"RUNNING");
    const intended=template.intendedChildren(snapshot),admissions=Math.max(1,Math.min(5,options.admissions??2));let admitted=0;
    for(const child of intended){
      if(children.some(c=>c.step_key===child.childKey))continue;
      if(admitted>=admissions)break;
      const s=(await db.query<{id:string;state:string;output_snapshot:{pendingQuoteId?:string}|null}>("SELECT id,state,output_snapshot FROM workflow_steps WHERE workspace_id=$1 AND workflow_run_id=$2 AND step_key=$3",[run.workspace_id,run.id,child.childKey])).rows[0];
      if(["CANCELLED","SKIPPED"].includes(s.state))continue;
      if((await stepState(db,s.id,"READY")).rowCount)await workflowEvent(db,run,"STEP_READY",s.id);
      if(options.fault)await options.fault("AFTER_READY");
      const input=snapshot.prepared[child.inputIndex];
      let quote=(await db.query<{id:string;quote_hash:string;token_amount:string;expires_at:Date}>(`SELECT q.* FROM billing_quotes q JOIN price_catalogs c ON c.operation=q.operation AND c.realm=$4 AND c.active_version_id=q.price_version_id WHERE q.workspace_id=$1 AND q.id=$2 AND q.input_hash=$3 AND q.expires_at>now()`,[run.workspace_id,s.output_snapshot?.pendingQuoteId||null,inputHash(input),billingRealm()])).rows[0];
      try{
        if(!quote){const q=await createQuote(db,run.workspace_id,run.created_by,input.kind,input,child.requestHash);quote={id:q.id,quote_hash:q.quoteHash,token_amount:q.tokenAmount,expires_at:new Date(q.expiresAt)};await stepState(db,s.id,"READY",{pendingQuoteId:q.id,estimatedTokens:q.tokenAmount});}
        if(BigInt(totals.committed)+BigInt(quote.token_amount)>BigInt(run.max_tokens)){await state(db,run,"PAUSED","BUDGET_EXCEEDED","Increase the workflow budget to admit the next child.");return true;}
        const result=await admitOperation(db,{workspaceId:run.workspace_id,userId:run.created_by,input,requestHash:child.requestHash,key:`workflow:${run.id}:${child.childKey}`,quote:{quoteId:quote.id,quoteHash:quote.quote_hash},workflow:{runId:run.id,stepId:s.id}});
        if(options.fault)await options.fault("AFTER_ADMISSION");
        await db.query("INSERT INTO workflow_child_jobs(workspace_id,workflow_run_id,workflow_step_id,job_id,child_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",[run.workspace_id,run.id,s.id,result.id,child.childKey]);
        await stepState(db,s.id,"RUNNING",{jobId:result.id});await workflowEvent(db,run,"CHILD_JOB_CREATED",s.id,{jobId:result.id,tokens:quote.token_amount});
        totals=await workflowTotals(db,run.workspace_id,run.id);await db.query("UPDATE workflow_runs SET tokens_committed=$1 WHERE id=$2",[totals.committed,run.id]);admitted++;
      }catch(error){
        if(!(error instanceof AppError))throw error;
        if(error.status===402){await state(db,run,"WAITING_FOR_FUNDS","INSUFFICIENT_FUNDS","Add tokens in Billing to continue this workflow.");return true;}
        if(error.safeCode==='WORKSPACE_QUOTA'){await state(db,run,'RUNNING','WORKSPACE_QUOTA','Waiting for workspace capacity. Existing children continue.');return true;}
        if(error.status===409){await stepState(db,s.id,"READY",{});await state(db,run,"RUNNING");return true;}
        await state(db,run,"PAUSED","ADMISSION_UNAVAILABLE",error.message.slice(0,240));return true;
      }
    }
    if(admitted||children.length<intended.length||children.some(c=>!["SUCCEEDED","FAILED","CANCELLED"].includes(c.status)||c.billing_status==="RESERVED"||c.status==="SUCCEEDED"&&c.publication_status!=="PUBLISHED")){await state(db,run,"RUNNING");return true;}
    const decision=template.reconcile(snapshot,outcomes);
    if(decision.state==="WAITING_FOR_REVIEW"){await state(db,run,"WAITING_FOR_REVIEW");return true;}
    const result={approvedContentIds:outcomes.filter(o=>o.decision==="APPROVED").map(o=>o.contentId),rejectedContentIds:outcomes.filter(o=>o.decision==="REJECTED").map(o=>o.contentId),contentVersions:outcomes,childJobIds:children.map(c=>c.job_id),tokensCaptured:totals.captured,tokensReleased:totals.released,tokensRefunded:totals.refunded};
    await db.query("UPDATE workflow_runs SET result=$1::jsonb WHERE id=$2",[JSON.stringify(result),run.id]);
    const complete=(await db.query<{id:string}>("SELECT id FROM workflow_steps WHERE workflow_run_id=$1 AND step_key='complete'",[run.id])).rows[0];await stepState(db,complete.id,decision.state,result);
    await state(db,run,decision.state,decision.code,decision.code?decision.code==="NO_APPROVED_CONTENT"?"All produced content was rejected.":decision.code==="NO_USABLE_CONTENT"?"No child produced usable content.":"The exact content versions did not satisfy the review policy.":null);
    return true;
  });
}
export async function workflowBatch(limit=25){let count=0;for(;count<Math.max(1,Math.min(100,limit));count++)if(!await reconcileWorkflowOne())break;return count;}
export async function workflowPublicTotals(workspaceId:string,runId:string){return workflowTotals({query},workspaceId,runId);}
