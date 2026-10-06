// Controlled remote-test database only. Checks preservation inside the migration transaction.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import pg from 'pg';
process.loadEnvFile('.env.local');
const mode=process.argv[2]||'--inventory',root='.next-tests/phase-c';
if(!['--inventory','--apply','--verify'].includes(mode))throw new Error('Use --inventory|--apply|--verify');
const before=JSON.parse(await readFile(`${root}/live-before.json`,'utf8'));
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const d=new pg.Client({connectionString:process.env.DATABASE_URL});let stage='connect',begun=false;
const requireEqual=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(label);};
const keys={job_billing:'job_id',...Object.fromEntries(Object.keys(before.fingerprints).filter(x=>x!=='job_billing').map(x=>[x,'id']))};
async function fingerprints(db,after=false){const out={};for(const t of Object.keys(before.fingerprints)){const rows=(await db.query(`SELECT * FROM ${t} ORDER BY ${keys[t]}`)).rows;if(after)for(const r of rows){delete r.billing_account_id;if(t==='token_ledger_entries')delete r.idempotency_scope;}out[t]={rows:rows.length,sha256:hash(rows)};}return out;}
async function schema(db){
 const queries={columns:"SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",constraints:"SELECT c.relname AS table_name,p.conname,pg_get_constraintdef(p.oid) AS definition FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,p.conname",triggers:"SELECT c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid) AS definition,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",functions:"SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)",indexes:"SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname"};
 const result={};for(const [key,sql] of Object.entries(queries))result[key]=(await db.query(sql)).rows;return result;
}
async function canonicalSchema(){
 const name=`phase_c_schema_${Date.now()}_${randomBytes(3).toString('hex')}`,url=new URL(process.env.DATABASE_URL);url.pathname=`/${name}`;let created=false,c;
 try{await d.query(`CREATE DATABASE "${name}"`);created=true;c=new pg.Client({connectionString:url.toString()});await c.connect();await c.query('CREATE TABLE schema_migrations (name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');for(const m of before.migrations)await c.query(await readFile(`migrations/${m.name}`,'utf8'));return await schema(c);}
 finally{await c?.end().catch(()=>{});if(created)await d.query(`DROP DATABASE "${name}" WITH (FORCE)`);}
}
async function originalEvidence(){const files=JSON.parse(await readFile(`${root}/preserved-original-evidence.json`,'utf8'));for(const f of files)requireEqual(createHash('sha256').update(await readFile(f.path)).digest('hex'),f.sha256,'ORIGINAL_ACCEPTANCE_EVIDENCE_CHANGED');return files.length;}
async function checkBefore(){
 const migrations=(await d.query('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;requireEqual(migrations,before.migrations,'REMOTE_MIGRATION_HISTORY_CHANGED');for(const m of migrations)requireEqual(hash(await readFile(`migrations/${m.name}`,'utf8')),m.sha256,'APPLIED_MIGRATION_EDITED');
 requireEqual(await fingerprints(d),before.fingerprints,'REMOTE_HISTORICAL_FINGERPRINT_CHANGED');
 for(const [table,count] of Object.entries(before.counts))requireEqual(Number((await d.query(`SELECT count(*) n FROM ${table}`)).rows[0].n),count,'REMOTE_INVENTORY_COUNT_CHANGED');
 const wallets=(await d.query('SELECT coalesce(sum(available_tokens),0)::text available,coalesce(sum(reserved_tokens),0)::text reserved FROM workspace_wallets')).rows[0];requireEqual(wallets,before.wallets,'REMOTE_WALLET_TOTAL_CHANGED');
 const mapping=(await d.query("SELECT w.id,w.created_by,w.status,a.available_tokens,a.reserved_tokens,ARRAY(SELECT m.user_id FROM workspace_members m WHERE m.workspace_id=w.id AND m.role='OWNER' AND m.status='ACTIVE' ORDER BY m.user_id) owners FROM workspaces w JOIN workspace_wallets a ON a.workspace_id=w.id ORDER BY w.id")).rows;
 for(const row of mapping){const old=before.mapping.find(x=>x.id===row.id);if(!old||old.ambiguous)throw new Error('AMBIGUOUS_ACCOUNT_BOUNDARY');for(const k of ['created_by','status','available_tokens','reserved_tokens','owners'])requireEqual(row[k],old[k],'REMOTE_ACCOUNT_BOUNDARY_CHANGED');}
 return wallets;
}
async function checkAfter(){
 requireEqual(await fingerprints(d,true),before.fingerprints,'HISTORICAL_FINGERPRINT_CHANGED');
 const totals=(await d.query('SELECT coalesce(sum(available_tokens),0)::text available,coalesce(sum(reserved_tokens),0)::text reserved FROM billing_account_wallets')).rows[0];requireEqual(totals,before.wallets,'MIGRATION_VALUE_CHANGED');
 const wallets=(await d.query('SELECT a.legacy_group_key,w.available_tokens,w.reserved_tokens FROM billing_accounts a JOIN billing_account_wallets w ON w.billing_account_id=a.id ORDER BY a.legacy_group_key')).rows;
 const groups=new Map();for(const m of before.mapping){const g=groups.get(m.groupKey)||{available:0n,reserved:0n};g.available+=BigInt(m.available_tokens);g.reserved+=BigInt(m.reserved_tokens);groups.set(m.groupKey,g);}
 requireEqual(wallets.length,groups.size,'ACCOUNT_COUNT_CHANGED');for(const a of wallets){const g=groups.get(a.legacy_group_key);if(!g)throw new Error('UNEXPECTED_ACCOUNT');requireEqual([a.available_tokens,a.reserved_tokens],[g.available.toString(),g.reserved.toString()],'ACCOUNT_AGGREGATE_CHANGED');}
 const mapped=(await d.query('SELECT w.id,a.legacy_group_key FROM workspaces w JOIN billing_accounts a ON a.id=w.billing_account_id ORDER BY w.id')).rows;requireEqual(mapped.length,before.mapping.length,'WORKSPACE_COUNT_CHANGED');for(const m of mapped)requireEqual(m.legacy_group_key,before.mapping.find(x=>x.id===m.id)?.groupKey,'WORKSPACE_MAPPING_CHANGED');
 const drift=Number((await d.query('SELECT count(*) n FROM billing_account_wallets a LEFT JOIN (SELECT billing_account_id,sum(available_delta) av,sum(reserved_delta) r FROM token_ledger_entries GROUP BY billing_account_id) l USING(billing_account_id) WHERE a.available_tokens<>coalesce(l.av,0) OR a.reserved_tokens<>coalesce(l.r,0)')).rows[0].n);requireEqual(drift,0,'ACCOUNT_LEDGER_DRIFT');
 const reservedDrift=Number((await d.query("SELECT count(*) n FROM billing_account_wallets a LEFT JOIN (SELECT billing_account_id,sum(token_amount) r FROM job_billing WHERE status='RESERVED' GROUP BY billing_account_id) b USING(billing_account_id) WHERE a.reserved_tokens<>coalesce(b.r,0)")).rows[0].n);requireEqual(reservedDrift,0,'ACCOUNT_RESERVATION_DRIFT');
 requireEqual((await d.query("SELECT to_regclass('workspace_wallets') IS NULL removed")).rows[0].removed,true,'SECOND_WALLET_MODEL_REMAINS');
 return {totals,accounts:wallets.length,workspaces:mapped.length,drift,reservedDrift,history:before.fingerprints,groups:wallets.map(a=>{const m=before.mapping.find(x=>x.groupKey===a.legacy_group_key);return {accountLabel:m.creatorLabel,workspaces:before.mapping.filter(x=>x.groupKey===a.legacy_group_key).map(x=>x.workspaceLabel),available:a.available_tokens,reserved:a.reserved_tokens};})};
}
try{
 await d.connect();stage='preserved-evidence';const originalEvidenceFiles=await originalEvidence();
 if(mode==='--inventory'){
  stage='schema-canonical-check';const live=await schema(d),expected=await canonicalSchema();requireEqual(live,expected,'REMOTE_SCHEMA_DIFFERS_FROM_TESTED_BASELINE');stage='inventory-match';await checkBefore();
  const snapshot={capturedAt:new Date().toISOString(),schemaHash:hash(live),schema:live,originalEvidenceFiles};await writeFile(`${root}/live-gate.json`,JSON.stringify(snapshot,null,2));
  await mkdir('docs/phase-c-evidence',{recursive:true});await writeFile('docs/phase-c-evidence/live-inventory.json',JSON.stringify({status:'PASS',capturedAt:before.capturedAt,counts:before.counts,wallets:before.wallets,ledger:before.ledger,projectionDrift:before.projectionDrift,reservedJobs:before.reservedJobs,proposedAccounts:new Set(before.mapping.map(x=>x.groupKey)).size,ambiguous:before.mapping.filter(x=>x.ambiguous).length,mapping:before.mapping.map(m=>({workspace:m.workspaceLabel,creator:m.creatorLabel,classification:m.classification,available:m.available_tokens,reserved:m.reserved_tokens})),fingerprints:before.fingerprints,schemaMatchesTestedBaseline:true,schemaHash:hash(live),originalEvidenceFiles},null,2));console.log(JSON.stringify({status:'PASS',mode,accounts:14,workspaces:21,available:before.wallets.available,reserved:before.wallets.reserved,schemaMatchesTestedBaseline:true,originalEvidenceFiles}));
 }else if(mode==='--apply'){
  stage='isolated-test-gate';const migration=JSON.parse(await readFile('docs/phase-c-evidence/migration.json','utf8'));if(migration.status!=='PASS')throw new Error('ISOLATED_MIGRATION_NOT_PASS');
  for(const name of ['integration','browser','shared','focused','restart','phase-b']){const test=JSON.parse(await readFile(`docs/phase-c-evidence/${name}-run.json`,'utf8'));if(test.exitCode!==0)throw new Error('ISOLATED_SUITE_NOT_PASS');}
  const gate=JSON.parse(await readFile(`${root}/live-gate.json`,'utf8'));stage='schema-recheck';requireEqual(hash(await schema(d)),gate.schemaHash,'REMOTE_SCHEMA_CHANGED_AFTER_INVENTORY');
  await d.query('SELECT pg_advisory_lock(731052133)');await d.query('BEGIN');begun=true;await d.query('LOCK TABLE workspaces,workspace_members,workspace_wallets,token_ledger_entries,billing_quotes,job_billing,payments IN ACCESS EXCLUSIVE MODE');stage='before-recheck';await checkBefore();
  const name='0013_shared_billing_accounts.sql',sql=await readFile(`migrations/${name}`,'utf8'),migrationHash=hash(sql);requireEqual(migrationHash,migration.migrationSha256,'MIGRATION_CHANGED_AFTER_PROOF');stage='migration';await d.query(sql);stage='after-proof';const proof=await checkAfter();await d.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[name,migrationHash]);await d.query('COMMIT');begun=false;
  await writeFile('docs/phase-c-evidence/live-migration.json',JSON.stringify({status:'PASS',appliedAt:new Date().toISOString(),migration:name,migrationSha256:migrationHash,before:before.wallets,after:proof.totals,accounts:proof.accounts,workspaces:proof.workspaces,accountAggregates:proof.groups,historicalFingerprints:proof.history,drift:proof.drift,reservedDrift:proof.reservedDrift,ledgerEntriesCreated:0,historyUnchanged:true,originalEvidenceFiles},null,2));console.log(JSON.stringify({status:'PASS',mode,before:before.wallets,after:proof.totals,accounts:proof.accounts,workspaces:proof.workspaces,historicalFingerprintsMatch:true,ledgerEntriesCreated:0}));
 }else{stage='after-verification';const proof=await checkAfter();console.log(JSON.stringify({status:'PASS',mode,available:proof.totals.available,reserved:proof.totals.reserved,historicalFingerprintsMatch:true,originalEvidenceFiles}));}
}catch(e){if(begun)await d.query('ROLLBACK').catch(()=>{});console.log(JSON.stringify({status:'STOP',stage,code:typeof e.code==='string'?e.code:'PRESERVATION_GATE_FAILED',reason:/^[A-Z_]+$/.test(e.message)?e.message:undefined}));process.exitCode=1;}
finally{await d.query('SELECT pg_advisory_unlock(731052133)').catch(()=>{});await d.end().catch(()=>{});}
