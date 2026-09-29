import pg from "pg";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

const apply=process.argv.includes("--apply");
const test=process.argv.includes("--test");
const hours=Number(process.env.PENDING_UPLOAD_RETENTION_HOURS||24);
if(!Number.isFinite(hours)||hours<1)throw new Error("PENDING_UPLOAD_RETENTION_HOURS must be at least 1");
const databaseUrl=process.env[test?"TEST_DATABASE_URL":"DATABASE_URL"];
const bucket=process.env[test?"TEST_OBJECT_STORAGE_BUCKET":"OBJECT_STORAGE_BUCKET"];
if(!databaseUrl||!bucket)throw new Error("Selected database and bucket must be configured");
const db=new pg.Client({connectionString:databaseUrl});
const s3=new S3Client({endpoint:process.env.OBJECT_STORAGE_ENDPOINT,region:process.env.OBJECT_STORAGE_REGION,credentials:{accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY,secretAccessKey:process.env.OBJECT_STORAGE_SECRET_KEY},forcePathStyle:true});
try {
  await db.connect();
  const candidates=await db.query(`SELECT id,workspace_id,product_id,asset_id,upload_key,created_at FROM asset_versions
    WHERE status='PENDING_UPLOAD' AND created_at < now()-($1::double precision * interval '1 hour')
    ORDER BY created_at ASC LIMIT 100`,[hours]);
  console.log(`${apply?"Applying":"Dry run:"} ${candidates.rowCount} abandoned uploads older than ${hours} hours in ${bucket}.`);
  if(!apply){console.log("Pass --apply to mark these uploads failed and remove only their staging objects.");process.exitCode=0;}
  else {
    let failed=0;
    for(const row of candidates.rows){
      const marked=await db.query(`UPDATE asset_versions SET status='FAILED',failure_code='ABANDONED_UPLOAD'
        WHERE id=$1 AND workspace_id=$2 AND product_id=$3 AND asset_id=$4 AND status='PENDING_UPLOAD'
        RETURNING id`,[row.id,row.workspace_id,row.product_id,row.asset_id]);
      if(!marked.rowCount)continue;
      await db.query(`UPDATE assets SET status='FAILED',updated_at=now() WHERE id=$1 AND workspace_id=$2 AND product_id=$3
        AND status='PENDING_UPLOAD' AND current_version_id IS NULL`,[row.asset_id,row.workspace_id,row.product_id]);
      try {await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:row.upload_key}));}
      catch(error){console.error(`Staging cleanup failed for upload ${row.id}:`,error);failed++;}
    }
    console.log(`${candidates.rowCount-failed} staging objects removed or absent; ${failed} need retry.`);
    if(failed)process.exitCode=1;
  }
} finally {await db.end().catch(()=>undefined);s3.destroy();}
