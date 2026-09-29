import Link from "next/link";
import { Shell } from "@/components/shell";
import { pageWorkspace } from "@/lib/page";
import { customerJobList } from "@/lib/jobs";

export default async function JobsPage({searchParams}:{searchParams:Promise<{status?:string;page?:string}>}){
  const {session,workspaces,current}=await pageWorkspace(),params=await searchParams;
  const data=await customerJobList(session,current.id,{status:params.status,page:Number(params.page||1)});
  const filter=params.status||"ALL";
  return <Shell user={session} workspaces={workspaces} current={current}>
    <div className="page-heading"><div><p className="eyebrow">WORKSPACE ACTIVITY</p><h1>Jobs</h1><p>Real processing status for this workspace.</p></div></div>
    <form className="filter-bar" action="/jobs"><label>Status <select name="status" defaultValue={filter}><option value="ALL">All</option><option value="QUEUED">Queued</option><option value="WAITING_FOR_WORKER">Waiting for worker</option><option value="RUNNING">Running</option><option value="SUCCEEDED">Succeeded</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option></select></label><button className="button secondary" type="submit">Filter</button></form>
    <p className="muted">{data.total} {data.total===1?"job":"jobs"} in this view</p>
    {data.jobs.length?<div className="catalog-list">{data.jobs.map(row=>{const job=row as {id:string;type:string;status:string;progress_percent:number;progress_stage:string;created_at:Date;attempt_count:number};return <Link href={`/jobs/${job.id}`} className="catalog-card" key={job.id}><div><span className="eyebrow">{job.type.replaceAll("_"," ")}</span><h2>Job {job.id.slice(0,8)}</h2><p>{new Date(job.created_at).toLocaleString("en-US",{timeZone:"UTC"})} UTC · Attempt {job.attempt_count}</p></div><div className="job-list-status"><span className="pill">{job.status.replaceAll("_"," ")}</span><strong>{job.progress_percent}%</strong></div></Link>;})}</div>:<section className="panel empty-panel"><h2>No jobs yet</h2><p>Processing activity will appear here when a supported feature creates a Job.</p></section>}
    <div className="pagination">{data.page>1&&<Link href={`/jobs?status=${filter}&page=${data.page-1}`}>Previous</Link>}{data.page*data.pageSize<data.total&&<Link href={`/jobs?status=${filter}&page=${data.page+1}`}>Next</Link>}</div>
  </Shell>;
}
