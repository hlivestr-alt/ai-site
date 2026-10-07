// Supplemental read-only check after the operator resumed normal Clipper work.
// Keep the strict full-table drift result; never replace or reset the baseline.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import pg from 'pg';
process.loadEnvFile('.env.local');
const before=JSON.parse(await readFile('.next-tests/phase-e/live-before.json','utf8'));
const applied=JSON.parse(await readFile('docs/phase-e-evidence/live-migration.json','utf8'));
const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const assert=(condition,code)=>{if(!condition)throw new Error(code);};
const appended=new Set(['billing_quotes','token_ledger_entries','job_billing','jobs','job_attempts','job_artifacts','clipper_checkpoints']);
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
const result={status:'FAIL',scope:'historical rows and migration; operator runtime remains active',operatorConfirmedClipperJobs:2,strictFullTableDriftExpected:true,remoteSmokeDataMutations:0,checks:[]};
try{
 assert(applied.status==='PASS'&&applied.applied&&JSON.stringify(applied.historicalFingerprints)===JSON.stringify(before.fingerprints),'MIGRATION_PROOF_INVALID');
 await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const migrationTime=(await db.query('SELECT applied_at FROM schema_migrations WHERE name=$1',['0015_outreach_saas.sql'])).rows[0]?.applied_at;
 const newerJobs=(await db.query('SELECT id,type,created_at FROM jobs ORDER BY created_at DESC LIMIT 2')).rows;
 assert(newerJobs.length===2&&newerJobs.every(j=>j.type==='CLIPPER'&&j.created_at>migrationTime),'OPERATOR_JOB_SCOPE_CHANGED');
 const newIds=newerJobs.map(j=>j.id);
 for(const [table,original] of Object.entries(before.fingerprints)){
  assert(/^[a-z_]+$/.test(table),'INVALID_TABLE');
  const count=Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n);
  if(table==='billing_account_wallets'||table==='source_assets'){
   assert(count===original.rows,'LIVE_RUNTIME_IDENTITY_COUNT_CHANGED');
   result.checks.push({table,originalRows:original.rows,currentRows:count,fullFingerprintUnchanged:false,reason:table==='source_assets'?'operator source-validation metadata; existing immutable identity trigger retained':'operator Clipper reservations; checked against ledger below'});
   continue;
  }
  assert(count>=original.rows&&(!appended.has(table)?count===original.rows:true),'UNEXPECTED_HISTORICAL_ROW_COUNT');
  const subset=appended.has(table)?`(SELECT * FROM ${table} ORDER BY created_at ASC LIMIT $1)`:table;
  const rows=(await db.query(`SELECT to_jsonb(t) r FROM ${subset} t ORDER BY to_jsonb(t)::text`,appended.has(table)?[original.rows]:[])).rows.map(r=>r.r);
  assert(digest(rows)===original.sha256,'ORIGINAL_HISTORICAL_ROW_CHANGED');
  result.checks.push({table,originalRows:original.rows,currentRows:count,originalRowsUnchanged:true,appendedRows:count-original.rows});
 }
 assert(Number((await db.query('SELECT count(*) n FROM jobs')).rows[0].n)===before.fingerprints.jobs.rows+2,'UNCONFIRMED_LIVE_JOB');
 for(const table of ['job_billing','job_attempts','job_artifacts','clipper_checkpoints','token_ledger_entries']){
  const count=Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n)-before.fingerprints[table].rows;
  const additions=(await db.query(`SELECT job_id FROM ${table} ORDER BY created_at DESC LIMIT $1`,[count])).rows;
  assert(additions.every(r=>newIds.includes(r.job_id)),'ADDITION_OUTSIDE_OPERATOR_JOBS');
 }
 const quotes=(await db.query('SELECT operation FROM billing_quotes ORDER BY created_at DESC LIMIT $1',[(await db.query('SELECT count(*)::int n FROM billing_quotes')).rows[0].n-before.fingerprints.billing_quotes.rows])).rows;
 assert(quotes.every(q=>q.operation==='CLIPPER'),'NON_CLIPPER_RUNTIME_QUOTE');
 const mismatches=Number((await db.query('SELECT count(*) n FROM (SELECT w.billing_account_id FROM billing_account_wallets w LEFT JOIN token_ledger_entries l ON l.billing_account_id=w.billing_account_id GROUP BY w.billing_account_id,w.available_tokens,w.reserved_tokens HAVING w.available_tokens<>coalesce(sum(l.available_delta),0) OR w.reserved_tokens<>coalesce(sum(l.reserved_delta),0)) t')).rows[0].n);
 assert(mismatches===0,'LIVE_WALLET_LEDGER_MISMATCH');
 result.wallet=(await db.query('SELECT sum(available_tokens)::text available,sum(reserved_tokens)::text reserved FROM billing_account_wallets')).rows[0];
 result.walletLedgerMatches=true;
 const identityGuard=(await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='source_assets'::regclass AND tgname='source_assets_immutable' AND tgenabled='O'")).rows[0].n;
 assert(identityGuard===1,'SOURCE_IDENTITY_GUARD_DISABLED');result.sourceIdentityGuardEnabled=true;
 for(const table of ['outreach_channels','outreach_creators','outreach_campaigns','outreach_recipients','outreach_deliveries','outreach_test_receipts'])assert(Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n)===0,'LIVE_OUTREACH_TEST_DATA');
 result.liveOutreachEntities=0;result.migrationPreservedAll22Fingerprints=true;result.baselineWallet=before.wallet;
 await db.query('COMMIT');result.status='PASS';
}catch(e){result.code=/^[A-Z_]+$/.test(e?.message||'')?e.message:'RUNTIME_PRESERVATION_CHECK_FAILED';process.exitCode=1;}finally{await db.end().catch(()=>{});}
await writeFile('docs/phase-e-evidence/runtime-preservation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
