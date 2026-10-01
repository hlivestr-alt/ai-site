import {query,type DbClient} from './db';
import {AppError} from './core';
import {boundedSetting} from './operational-config';
export const LIMIT_DEFAULTS={active_jobs:20,active_workflows:10,queued_ai_videos:10,queued_clipper_jobs:5,source_uploads_daily:20,storage_bytes:21474836480,product_assets:500} as const;
export type LimitName=keyof typeof LIMIT_DEFAULTS;
export const ACTIVE_JOB_STATES=['QUEUED','WAITING_FOR_WORKER','RUNNING','RECONCILING'];
export function operationStorageBudget(input:{kind:string;targetClipCount?:number}){if(input.kind==='AI_VIDEO')return boundedSetting('MAX_GENERATED_VIDEO_BYTES',268435456,1048576,536870912);if(input.kind==='CLIPPER')return (input.targetClipCount||1)*boundedSetting('MAX_CLIPPER_OUTPUT_BYTES',268435456,1048576,536870912)+88080384;return 0;}
export async function additionalArtifactBytes(db:DbClient,jobId:string,bytes:number){const job=(await db.query<{input_snapshot:{kind:string;targetClipCount?:number};status:string}>('SELECT input_snapshot,status FROM jobs WHERE id=$1',[jobId])).rows[0];const allocated=(await db.query<{bytes:string}>("SELECT coalesce(sum(expected_byte_size),0)::text AS bytes FROM job_artifacts WHERE job_id=$1 AND status IN('PENDING','READY')",[jobId])).rows[0].bytes;const remaining=job&&ACTIVE_JOB_STATES.includes(job.status)?Math.max(0,operationStorageBudget(job.input_snapshot)-Number(allocated)):0;return Math.max(0,bytes-remaining);}
export async function workspaceQuotaLock(db:DbClient,workspaceId:string){await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,9))',[workspaceId]);}
export async function workspaceLimits(workspaceId:string,db:DbClient={query}){
  const overrides=(await db.query<{limit_name:LimitName;limit_value:string;updated_at:Date}>('SELECT limit_name,limit_value::text,updated_at FROM workspace_limits WHERE workspace_id=$1',[workspaceId])).rows;
  return Object.entries(LIMIT_DEFAULTS).map(([name,fallback])=>{
    const override=overrides.find(o=>o.limit_name===name),configured=process.env[`QUOTA_${name.toUpperCase()}`]||String(fallback);
    if(!/^\d+$/.test(configured)||BigInt(configured)<1n||BigInt(configured)>9007199254740991n)throw new AppError(503,'Workspace limits are unavailable.');
    return {name:name as LimitName,value:override?.limit_value||configured,source:override?'workspace_override':process.env[`QUOTA_${name.toUpperCase()}`]?'environment':'default',updatedAt:override?.updated_at||null};
  });
}
async function ceiling(db:DbClient,workspaceId:string,name:LimitName){return BigInt((await workspaceLimits(workspaceId,db)).find(l=>l.name===name)!.value);}
function exceeded(name:LimitName){return new AppError(429,`Workspace ${name.replaceAll('_',' ')} limit reached. Try again later or contact support.`,'WORKSPACE_QUOTA',60);}
export async function checkJobQuota(db:DbClient,workspaceId:string,type:'AI_VIDEO'|'CLIPPER'){
  await workspaceQuotaLock(db,workspaceId);
  const counts=(await db.query<{active:string;queued:string}>(`SELECT count(*) FILTER(WHERE status=ANY($2::text[]))::text AS active,count(*) FILTER(WHERE type=$3 AND status IN('QUEUED','WAITING_FOR_WORKER'))::text AS queued FROM jobs WHERE workspace_id=$1`,[workspaceId,ACTIVE_JOB_STATES,type])).rows[0];
  if(BigInt(counts.active)>=await ceiling(db,workspaceId,'active_jobs'))throw exceeded('active_jobs');
  const name=type==='AI_VIDEO'?'queued_ai_videos':'queued_clipper_jobs';if(BigInt(counts.queued)>=await ceiling(db,workspaceId,name))throw exceeded(name);
}
export async function checkWorkflowQuota(db:DbClient,workspaceId:string){await workspaceQuotaLock(db,workspaceId);const n=(await db.query<{count:string}>("SELECT count(*)::text FROM workflow_runs WHERE workspace_id=$1 AND status NOT IN('SUCCEEDED','FAILED','CANCELLED')",[workspaceId])).rows[0].count;if(BigInt(n)>=await ceiling(db,workspaceId,'active_workflows'))throw exceeded('active_workflows');}
export async function workspaceStorageUsage(workspaceId:string,db:DbClient={query}){
  const categories=(await db.query<{category:string;bytes:string;objects:string;unmeasured:string}>(`SELECT category,coalesce(sum(byte_size),0)::text AS bytes,count(*)::text AS objects,count(*) FILTER(WHERE byte_size IS NULL)::text AS unmeasured FROM workspace_storage_objects WHERE workspace_id=$1 GROUP BY category ORDER BY category`,[workspaceId])).rows;
  const pending=(await db.query<{bytes:string}>(`SELECT coalesce(sum(bytes),0)::text AS bytes FROM (
    SELECT expected_byte_size+CASE WHEN mime_type LIKE 'image/%' THEN 1048576 ELSE 0 END AS bytes FROM asset_versions WHERE workspace_id=$1 AND status='PENDING_UPLOAD'
    UNION ALL SELECT byte_size FROM source_assets WHERE workspace_id=$1 AND status='PENDING_UPLOAD'
    UNION ALL SELECT expected_byte_size FROM job_artifacts WHERE workspace_id=$1 AND status='PENDING'
    UNION ALL SELECT 1048576 FROM content_posters WHERE workspace_id=$1 AND status='PROCESSING'
    UNION ALL SELECT greatest(0,CASE WHEN j.type='AI_VIDEO' THEN $2::bigint ELSE coalesce((j.input_snapshot->>'targetClipCount')::bigint,1)*$3::bigint+88080384 END-(SELECT coalesce(sum(a.expected_byte_size),0) FROM job_artifacts a WHERE a.job_id=j.id AND a.status IN('PENDING','READY'))) FROM jobs j WHERE j.workspace_id=$1 AND j.type IN('AI_VIDEO','CLIPPER') AND j.status IN('QUEUED','WAITING_FOR_WORKER','RUNNING','RECONCILING')) allocations`,[workspaceId,operationStorageBudget({kind:'AI_VIDEO'}),boundedSetting('MAX_CLIPPER_OUTPUT_BYTES',268435456,1048576,536870912)])).rows[0].bytes;
  const bytes=categories.reduce((n,c)=>n+BigInt(c.bytes),0n),objects=categories.reduce((n,c)=>n+Number(c.objects),0),unmeasured=categories.reduce((n,c)=>n+Number(c.unmeasured),0);
  return {bytes:bytes.toString(),objectCount:objects,unmeasuredObjects:unmeasured,pendingBytes:pending,quotaBytes:(bytes+BigInt(pending)+BigInt(unmeasured)*1048576n).toString(),categories};
}
export async function checkStorageQuota(db:DbClient,workspaceId:string,additionalBytes=0){await workspaceQuotaLock(db,workspaceId);const usage=await workspaceStorageUsage(workspaceId,db);if(BigInt(usage.quotaBytes)+BigInt(additionalBytes)>await ceiling(db,workspaceId,'storage_bytes'))throw exceeded('storage_bytes');}
export async function checkSourceQuota(db:DbClient,workspaceId:string,bytes:number){await workspaceQuotaLock(db,workspaceId);const n=(await db.query<{count:string}>("SELECT count(*)::text FROM source_assets WHERE workspace_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",[workspaceId])).rows[0].count;if(BigInt(n)>=await ceiling(db,workspaceId,'source_uploads_daily'))throw exceeded('source_uploads_daily');await checkStorageQuota(db,workspaceId,bytes);}
export async function checkAssetQuota(db:DbClient,workspaceId:string,bytes:number,image:boolean,replacement:boolean){await workspaceQuotaLock(db,workspaceId);if(!replacement){const n=(await db.query<{count:string}>("SELECT count(*)::text FROM assets WHERE workspace_id=$1 AND status<>'ARCHIVED'",[workspaceId])).rows[0].count;if(BigInt(n)>=await ceiling(db,workspaceId,'product_assets'))throw exceeded('product_assets');}await checkStorageQuota(db,workspaceId,bytes+(image?1048576:0));}
