import pg from "pg";
import { randomBytes, randomUUID, createHash } from "node:crypto";

if(process.env.APP_ENV!=="local")throw new Error("Worker admin CLI is local-only");
const test=process.argv.includes("--test"),args=process.argv.slice(2).filter(x=>x!=="--test");
const [action,target,capabilitiesRaw,maxRaw]=args;
const databaseUrl=process.env[test?"TEST_DATABASE_URL":"DATABASE_URL"];
if(!databaseUrl)throw new Error("Selected database is not configured");
const db=new pg.Client({connectionString:databaseUrl});
const issue=async workerId=>{
  const credential=`wk_${workerId}.${randomBytes(32).toString("base64url")}`;
  const hash=createHash("sha256").update(credential).digest("hex");
  await db.query("INSERT INTO worker_credentials(worker_id,token_hash) VALUES($1,$2)",[workerId,hash]);
  return credential;
};
try {
  await db.connect();
  if(action==="create"){
    if(!target||target.length<2||target.length>100)throw new Error("Provide a 2–100 character worker name");
    const capabilities=(capabilitiesRaw||"SYSTEM_TEST").split(",").map(x=>x.trim()).filter(Boolean);
    if(!capabilities.length||capabilities.length>16||capabilities.some(x=>!/^[A-Z][A-Z0-9_]{1,79}$/.test(x)))throw new Error("Invalid capabilities");
    const max=Number(maxRaw||1);if(!Number.isInteger(max)||max<1||max>16)throw new Error("Invalid max concurrency");
    const id=randomUUID();
    await db.query("BEGIN");
    try{await db.query("INSERT INTO workers(id,name,capabilities,max_concurrency) VALUES($1,$2,$3::jsonb,$4)",[id,target,JSON.stringify(capabilities),max]);const credential=await issue(id);await db.query("COMMIT");console.log(JSON.stringify({workerId:id,credential}));}
    catch(error){await db.query("ROLLBACK");throw error;}
  } else if(action==="rotate"){
    if(!target)throw new Error("Worker ID required");
    await db.query("BEGIN");
    try{const found=await db.query("SELECT id FROM workers WHERE id=$1 AND status<>'DISABLED' FOR UPDATE",[target]);if(!found.rowCount)throw new Error("Worker unavailable");await db.query("UPDATE worker_credentials SET revoked_at=now() WHERE worker_id=$1 AND revoked_at IS NULL",[target]);const credential=await issue(target);await db.query("COMMIT");console.log(JSON.stringify({workerId:target,credential}));}
    catch(error){await db.query("ROLLBACK");throw error;}
  } else if(action==="revoke"){
    if(!target)throw new Error("Worker ID required");
    const result=await db.query("UPDATE worker_credentials SET revoked_at=now() WHERE worker_id=$1 AND revoked_at IS NULL",[target]);console.log(JSON.stringify({workerId:target,revoked:result.rowCount}));
  } else if(["drain","activate","disable"].includes(action)){
    if(!target)throw new Error("Worker ID required");
    const status={drain:"DRAINING",activate:"ACTIVE",disable:"DISABLED"}[action];
    const result=await db.query("UPDATE workers SET status=$1,disabled_at=CASE WHEN $1='DISABLED' THEN now() ELSE NULL END WHERE id=$2 RETURNING id,status",[status,target]);
    if(!result.rows[0])throw new Error("Worker unavailable");console.log(JSON.stringify(result.rows[0]));
  } else if(action==="status"){
    const workers=await db.query(`SELECT w.id,w.name,w.status,w.capabilities,w.agent_version,w.pipeline_version,w.max_concurrency,w.available_slots,w.last_heartbeat_at,
      (w.last_heartbeat_at>now()-interval '90 seconds') AS online,
      (SELECT count(*) FROM worker_leases l WHERE l.worker_id=w.id AND l.status='ACTIVE') AS active_leases FROM workers w ORDER BY w.registered_at DESC LIMIT 50`);
    const jobs=await db.query(`SELECT j.id,j.workspace_id,j.type,j.status,j.attempt_count,j.max_attempts,j.available_at,
      (SELECT min(expires_at) FROM worker_leases l WHERE l.job_id=j.id AND l.status='ACTIVE') AS lease_expiry
      FROM jobs j WHERE j.status IN ('QUEUED','WAITING_FOR_WORKER','RUNNING','RECONCILING') ORDER BY j.created_at DESC LIMIT 50`);
    console.log(JSON.stringify({workers:workers.rows,jobs:jobs.rows}));
  } else throw new Error("Usage: worker-admin <create name [capabilities] [max]|rotate id|revoke id|drain id|activate id|disable id|status> [--test]");
} finally {await db.end().catch(()=>undefined);}
