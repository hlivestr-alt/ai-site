import pg from "pg";
import { AbortMultipartUploadCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { assertStorageCredentials } from "../docker/storage-gateway-config.mjs";
import { stagingCleanupKeys } from "../docker/staging-retention.mjs";

const apply=process.argv.includes("--apply"),test=process.argv.includes("--test");
if(apply&&!['local','test'].includes(process.env.APP_ENV||''))throw new Error('Staging/production cleanup is report-only; use a reviewed audited retention procedure.');
const pendingHours=Number(process.env.PENDING_UPLOAD_RETENTION_HOURS||24),failedHours=Number(process.env.FAILED_UPLOAD_RETENTION_HOURS||24);
if(![pendingHours,failedHours].every(v=>Number.isFinite(v)&&v>=1&&v<=8760))throw new Error('Upload retention hours must be between 1 and 8760');
const databaseUrl=process.env[test?'TEST_DATABASE_URL':'DATABASE_URL'],bucket=process.env[test?'TEST_OBJECT_STORAGE_BUCKET':'OBJECT_STORAGE_BUCKET'];
if(!databaseUrl||!bucket)throw new Error('Selected database and bucket must be configured');
assertStorageCredentials();
const db=new pg.Client({connectionString:databaseUrl});
const s3=new S3Client({endpoint:process.env.OBJECT_STORAGE_ENDPOINT,region:process.env.OBJECT_STORAGE_REGION,credentials:{accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY,secretAccessKey:process.env.OBJECT_STORAGE_SECRET_KEY},forcePathStyle:true});
const assets=`SELECT 'asset' AS kind,v.*,a.current_version_id FROM asset_versions v JOIN assets a ON a.workspace_id=v.workspace_id AND a.id=v.asset_id
 WHERE v.verified_at IS NULL AND v.failed_staging_cleaned_at IS NULL AND a.current_version_id IS DISTINCT FROM v.id
 AND ((v.status='PENDING_UPLOAD' AND v.created_at<now()-($1::double precision*interval '1 hour')) OR (v.status='FAILED' AND coalesce(v.failed_at,v.created_at)<now()-($2::double precision*interval '1 hour')))
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.workspace_id=v.workspace_id AND j.input_snapshot->'product'->'assets' @> jsonb_build_array(jsonb_build_object('assetVersionId',v.id::text)))`;
const sources=`SELECT 'source' AS kind,s.* FROM source_assets s WHERE s.finalized_at IS NULL AND s.verified_at IS NULL AND s.failed_staging_cleaned_at IS NULL
 AND ((s.status='PENDING_UPLOAD' AND s.created_at<now()-($1::double precision*interval '1 hour')) OR (s.status='FAILED' AND coalesce(s.failed_at,s.created_at)<now()-($2::double precision*interval '1 hour')))
 AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.workspace_id=s.workspace_id AND j.input_snapshot->'source'->>'sourceAssetId'=s.id::text)`;
try {
  await db.connect();
  const candidates=[...(await db.query(assets+' ORDER BY v.created_at,v.id LIMIT 100',[pendingHours,failedHours])).rows,...(await db.query(sources+' ORDER BY s.created_at,s.id LIMIT 100',[pendingHours,failedHours])).rows].slice(0,100);
  console.log(JSON.stringify({event:'STAGING_CLEANUP_PLAN',apply,candidates:candidates.length,pendingHours,failedHours,maximum:100}));
  let removed=0,failed=0;
  for(const candidate of candidates){
    if(!apply){try{stagingCleanupKeys(candidate);console.log(JSON.stringify({event:'STAGING_CLEANUP_CANDIDATE',kind:candidate.kind,id:candidate.id,status:candidate.status}));}catch{failed++;}continue;}
    await db.query('BEGIN');
    try{
      const selection=candidate.kind==='asset'?assets:sources,alias=candidate.kind==='asset'?'v':'s';
      const row=(await db.query(selection+` AND ${alias}.id=$3 FOR UPDATE OF ${alias} SKIP LOCKED`,[pendingHours,failedHours,candidate.id])).rows[0];
      if(!row){await db.query('ROLLBACK');continue;}
      const keys=stagingCleanupKeys(row),table=row.kind==='asset'?'asset_versions':'source_assets';
      if(row.status==='PENDING_UPLOAD')await db.query(`UPDATE ${table} SET status='FAILED',failure_code='ABANDONED_UPLOAD',failed_at=now() WHERE id=$1`,[row.id]);
      if(row.kind==='asset')await db.query("UPDATE assets SET status='FAILED',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND status='PENDING_UPLOAD' AND current_version_id IS NULL",[row.workspace_id,row.asset_id]);
      if(row.multipart_upload_id)try{await s3.send(new AbortMultipartUploadCommand({Bucket:bucket,Key:row.upload_key,UploadId:row.multipart_upload_id}));}catch(e){if(e?.name!=='NoSuchUpload')throw e;}
      for(const key of keys)await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));
      // Abandoned pending intents get a second sweep after the FAILED grace,
      // covering a recently reissued upload signature without touching READY media.
      if(row.status==='FAILED')await db.query(`UPDATE ${table} SET failed_staging_cleaned_at=now() WHERE id=$1`,[row.id]);
      await db.query('COMMIT');removed++;
      console.log(JSON.stringify({event:'STAGING_CLEANUP_APPLIED',kind:row.kind,id:row.id,status:row.status,objects:keys.length}));
    }catch{await db.query('ROLLBACK').catch(()=>{});failed++;console.error(JSON.stringify({event:'STAGING_CLEANUP_FAILED',kind:candidate.kind,id:candidate.id}));}
  }
  console.log(JSON.stringify({event:'STAGING_CLEANUP_RESULT',apply,removed,failed}));if(failed)process.exitCode=1;
}finally{await db.end().catch(()=>{});s3.destroy();}
