import {jobWorkflowLineage} from "@/lib/workflows";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { JobCancel,JobRefresh } from "@/components/job-actions";
import { pageWorkspace } from "@/lib/page";
import { customerJobDetail } from "@/lib/jobs";
import { AppError } from "@/lib/core";
import { can,type Role } from "@/lib/permissions";

const date=(value:Date|null)=>value?`${new Date(value).toLocaleString("en-US",{timeZone:"UTC"})} UTC`:"—";
export default async function JobDetailPage({params}:{params:Promise<{jobId:string}>}){
  const {session,workspaces,current}=await pageWorkspace(),{jobId}=await params;
  const data=await customerJobDetail(session,current.id,jobId).catch(error=>{if(error instanceof AppError&&error.status===404)notFound();throw error;});
  const job=data.job as {id:string;type:string;status:string;progress_percent:number;progress_stage:string;progress_message:string;created_at:Date;started_at:Date|null;finished_at:Date|null;attempt_count:number;max_attempts:number;error_message_safe:string|null;cancel_requested_at:Date|null};
  const workflow=await jobWorkflowLineage(session,current.id,jobId);
  const active=["QUEUED","WAITING_FOR_WORKER","RUNNING","RECONCILING"].includes(job.status);
  return <Shell user={session} workspaces={workspaces} current={current}>
    <div className="breadcrumb"><Link href="/jobs">Jobs</Link> <span>›</span> {job.id.slice(0,8)}</div>
    <div className="page-heading"><div><p className="eyebrow">{job.type.replaceAll("_"," ")}</p><h1>Job {job.id.slice(0,8)}</h1><p>Workspace processing activity</p></div><span className="pill">{job.status.replaceAll("_"," ")}</span></div>
    {workflow&&<p className="notice">Workflow: <Link href={`/workflows/runs/${workflow.runId}`}>{workflow.name}</Link></p>}
    <div className="detail-actions"><JobRefresh active={active||data.billing?.status==="RESERVED"}/>{can(current.role as Role,"future:edit")&&active&&job.status!=="RECONCILING"&&<JobCancel workspaceId={current.id} jobId={job.id}/>}</div>
    {data.billing&&<p className="notice">Token cost: {data.billing.token_amount} · {data.billing.status}</p>}
    <section className="panel"><p className="eyebrow">PROGRESS</p><h2>{job.progress_percent}% · {job.progress_stage.replaceAll("_"," ")}</h2><progress className="job-progress" value={job.progress_percent} max={100}/><p>{job.cancel_requested_at?"Cancellation requested. The worker will stop at a safe checkpoint.":job.progress_message||"Waiting for the next update."}</p>{job.error_message_safe&&<p className="notice error">{job.error_message_safe}</p>}</section>
    <div className="detail-grid"><section className="panel"><p className="eyebrow">TIMING</p><h2>Job details</h2><dl className="job-facts"><div><dt>Created</dt><dd>{date(job.created_at)}</dd></div><div><dt>Started</dt><dd>{date(job.started_at)}</dd></div><div><dt>Finished</dt><dd>{date(job.finished_at)}</dd></div><div><dt>Attempts</dt><dd>{job.attempt_count} of {job.max_attempts}</dd></div></dl></section><section className="panel"><p className="eyebrow">HISTORY</p><h2>Attempts</h2>{data.attempts.map(row=>{const attempt=row as {id:string;attempt_number:number;status:string;progress_percent:number;error_message_safe:string|null};return <div className="list-row" key={attempt.id}><strong>Attempt {attempt.attempt_number}</strong><small>{attempt.status.toLowerCase()} · {attempt.progress_percent}% {attempt.error_message_safe||""}</small></div>;})}</section></div>
  </Shell>;
}
