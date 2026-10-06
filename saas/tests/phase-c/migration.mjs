// Owns fresh databases only; no provider, storage, SMTP, or payment network calls.
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import assert from 'node:assert/strict';
import pg from 'pg';
const config={...parseEnv(await readFile('.env.local','utf8')),...process.env};
if(!config.TEST_DATABASE_URL||config.TEST_DATABASE_URL===config.DATABASE_URL)throw new Error('Separate isolated database administration required');
const admin=new pg.Client({connectionString:config.TEST_DATABASE_URL}),owned=[],rows=[];
const migration='0013_shared_billing_accounts.sql',sql=await readFile('migrations/'+migration,'utf8');
let stage='bootstrap',exitCode=0;
const check=(label,value)=>{stage=label;assert.ok(value,label);rows.push({check:label,status:'PASS'});};
async function database(){const name='phase_c_migration_'+Date.now()+'_'+randomBytes(3).toString('hex');assert.match(name,/^phase_c_migration_[0-9]+_[a-f0-9]+$/);await admin.query('CREATE DATABASE "'+name+'"');owned.push(name);const url=new URL(config.TEST_DATABASE_URL);url.pathname='/'+name;const db=new pg.Client({connectionString:url.href});await db.connect();for(const file of (await readdir('migrations')).filter(f=>/^\d{4}_.+\.sql$/.test(f)&&f<migration).sort()){await db.query('BEGIN');try{await db.query(await readFile('migrations/'+file,'utf8'));await db.query('COMMIT');}catch(error){await db.query('ROLLBACK');throw error;}}return db;}
async function reject(db,label,operation){stage=label;let failed=false;await db.query('BEGIN');try{await operation();}catch{failed=true;}finally{await db.query('ROLLBACK');}check(label,failed);}
async function fingerprint(db,after=false){const out={};for(const table of ['token_ledger_entries','job_billing','payments','billing_quotes']){const values=(await db.query('SELECT * FROM '+table+' ORDER BY '+(table==='job_billing'?'job_id':'id'))).rows;if(after)for(const row of values){delete row.billing_account_id;delete row.idempotency_scope;}out[table]={rows:values.length,sha256:createHash('sha256').update(JSON.stringify(values)).digest('hex')};}return out;}
async function user(db,n){return (await db.query("INSERT INTO users(email,display_name,password_hash,status) VALUES($1,$2,'isolated-fixture-unusable','ACTIVE') RETURNING id",[('phase-c-'+n+'@example.test').toLowerCase(),'Customer '+n])).rows[0].id;}
async function workspace(db,owner,name){const id=(await db.query('INSERT INTO workspaces(name,slug,created_by) VALUES($1,$2,$3) RETURNING id',[name,name.toLowerCase().replaceAll(' ','-'),owner])).rows[0].id;await db.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'OWNER')",[id,owner]);return id;}
async function grant(db,ws,owner,amount,key='historical-grant'){await db.query("INSERT INTO token_ledger_entries(workspace_id,entry_type,available_delta,reserved_delta,operator_id,reason,idempotency_key) VALUES($1,'PROMOTIONAL_GRANT',$2,0,$3,'Isolated historical migration fixture',$4)",[ws,amount,owner,key]);}
async function reserve(db,ws,owner,version,amount,terminal){
 stage="historical reservation "+amount+" "+(terminal||"pending");
 await db.query('BEGIN');try{
 const hash='a'.repeat(64),q=(await db.query("INSERT INTO billing_quotes(workspace_id,created_by,operation,price_version_id,request_hash,input_hash,input_snapshot,token_amount,quote_hash,expires_at) VALUES($1,$2,'AI_VIDEO',$3,$4,$4,'{}',$5,$4,now()+interval '15 minutes') RETURNING id",[ws,owner,version,hash,amount])).rows[0].id;
 const job=(await db.query("INSERT INTO jobs(workspace_id,type,required_capability,input_snapshot,input_hash,client_request_hash,idempotency_key,created_by,billing_mode) VALUES($1,'AI_VIDEO','AI_VIDEO','{}',$2,$2,$3,$4,'PAID') RETURNING id",[ws,hash,randomUUID(),owner])).rows[0].id;
 await db.query('INSERT INTO job_billing(job_id,workspace_id,quote_id,price_version_id,token_amount) VALUES($1,$2,$3,$4,$5)',[job,ws,q,version,amount]);
 const ledger=(await db.query("INSERT INTO token_ledger_entries(workspace_id,entry_type,available_delta,reserved_delta,job_id,quote_id,idempotency_key) VALUES($1,'RESERVE',-$2::bigint,$2,$3,$4,$5) RETURNING id",[ws,amount,job,q,'job:'+job+':reserve'])).rows[0].id;
 await db.query('UPDATE job_billing SET reserve_ledger_id=$1 WHERE job_id=$2',[ledger,job]);
 if(terminal==='CAPTURE'){
  const attempt=(await db.query("INSERT INTO job_attempts(workspace_id,job_id,attempt_number,status) VALUES($1,$2,1,'SUCCEEDED') RETURNING id",[ws,job])).rows[0].id;
  await db.query("INSERT INTO job_artifacts(workspace_id,job_id,attempt_id,slot_name,status,storage_key,mime_type,expected_byte_size,byte_size,sha256) VALUES($1,$2,$3,'video','READY',$4,'video/mp4',10,10,$5)",[ws,job,attempt,'phase-c-fixture/'+job,hash]);
  await db.query("UPDATE jobs SET status='SUCCEEDED',attempt_count=1 WHERE id=$1",[job]);
 }else if(terminal==='RELEASE')await db.query("UPDATE jobs SET status='FAILED' WHERE id=$1",[job]);
 if(terminal){const entry=(await db.query("INSERT INTO token_ledger_entries(workspace_id,entry_type,available_delta,reserved_delta,job_id,idempotency_key) VALUES($1,$2,$3,-$4::bigint,$5,$6) RETURNING id",[ws,terminal,terminal==='RELEASE'?amount:'0',amount,job,'job:'+job+':'+terminal.toLowerCase()])).rows[0].id;await db.query('UPDATE job_billing SET status=$1,'+(terminal==='CAPTURE'?'capture':'release')+'_ledger_id=$2,settled_at=now() WHERE job_id=$3',[terminal==='CAPTURE'?'CAPTURED':'RELEASED',entry,job]);}
 await db.query('COMMIT');return job;
 }catch(error){await db.query('ROLLBACK');throw error;}
}
let proof;
try{
 await admin.connect();let db=await database();
 try{await db.query('BEGIN');await db.query(sql);await db.query('COMMIT');check('fresh bootstrap has one empty account-wallet model',(await db.query("SELECT to_regclass('workspace_wallets') IS NULL AS removed,(SELECT count(*) FROM billing_account_wallets) AS wallets")).rows[0].removed);}finally{await db.end();}
 db=await database();try{
 stage="historical fixture users and grants";const x=await user(db,'X'),y=await user(db,'Y'),team=await user(db,'Team'),a=await workspace(db,x,'Brand A'),b=await workspace(db,x,'Brand B'),c=await workspace(db,y,'Client C'),d=await workspace(db,x,'Joint Brand');
 await db.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$3,'EDITOR'),($2,$3,'EDITOR'),($4,$3,'OWNER')",[a,c,team,d]);
 await grant(db,a,x,'8000');await grant(db,b,x,'2600');await grant(db,c,y,'800');await grant(db,d,x,'123');
 const catalog=(await db.query("INSERT INTO price_catalogs(operation,realm) VALUES('AI_VIDEO','TEST') RETURNING id")).rows[0].id;
 const version=(await db.query("INSERT INTO price_versions(catalog_id,version_number,label,rules) VALUES($1,1,'Migration fixture','{}') RETURNING id",[catalog])).rows[0].id;
 await reserve(db,a,x,version,'560');await reserve(db,b,x,version,'600');await reserve(db,a,x,version,'700','CAPTURE');await reserve(db,b,x,version,'100','RELEASE');
 await db.query('BEGIN');const pack=(await db.query("INSERT INTO token_packages(code,realm) VALUES('migration-fixture','TEST') RETURNING id")).rows[0].id;
 const pv=(await db.query("INSERT INTO token_package_versions(package_id,version_number,label,token_amount,fiat_minor,currency) VALUES($1,1,'Migration fixture',260,100,'IDR') RETURNING id",[pack])).rows[0].id;
 const payment=(await db.query("INSERT INTO payments(workspace_id,created_by,package_version_id,token_amount,fiat_minor,currency,provider,provider_mode,reference_id,request_key,request_hash,status) VALUES($1,$2,$3,260,100,'IDR','fake','TEST',$4,'fixture-purchase',$5,'PAID') RETURNING id",[a,x,pv,randomUUID(),'b'.repeat(64)])).rows[0].id;
 const purchase=(await db.query("INSERT INTO token_ledger_entries(workspace_id,entry_type,available_delta,reserved_delta,payment_id,idempotency_key) VALUES($1,'PURCHASE',260,0,$2,'historical-purchase') RETURNING id",[a,payment])).rows[0].id;
 await db.query('UPDATE payments SET purchase_ledger_id=$1 WHERE id=$2',[purchase,payment]);await db.query('COMMIT');
 const before=await fingerprint(db),totalsBefore=(await db.query('SELECT sum(available_tokens)::text available,sum(reserved_tokens)::text reserved FROM workspace_wallets')).rows[0];
 await reject(db,'drift aborts migration and rolls back schema',async()=>{await db.query('ALTER TABLE workspace_wallets DISABLE TRIGGER wallet_projection_guard');await db.query('UPDATE workspace_wallets SET available_tokens=available_tokens+1 WHERE workspace_id=$1',[a]);await db.query(sql);});
 await reject(db,'ambiguous ownership aborts migration',async()=>{await db.query("UPDATE workspace_members SET status='REMOVED' WHERE workspace_id=$1 AND user_id=$2",[a,x]);await db.query(sql);});
 await db.query('BEGIN');await db.query(sql);await db.query('COMMIT');
 const map=(await db.query('SELECT id,billing_account_id FROM workspaces ORDER BY id')).rows,account=id=>map.find(w=>w.id===id).billing_account_id;
 check('sole original creator groups A and B',account(a)===account(b));
 check('shared invited member does not merge different customers',account(a)!==account(c));
 check('multiple owners conservatively produce a separate account',account(a)!==account(d));
 const balances=(await db.query('SELECT billing_account_id,available_tokens,reserved_tokens FROM billing_account_wallets ORDER BY billing_account_id')).rows;
 check('account value equals sum of original brand balances',balances.find(r=>r.billing_account_id===account(a)).available_tokens==='9000'&&balances.find(r=>r.billing_account_id===account(a)).reserved_tokens==='1160');
 const totalsAfter=(await db.query('SELECT sum(available_tokens)::text available,sum(reserved_tokens)::text reserved FROM billing_account_wallets')).rows[0];
 check('global Tokens preserved exactly',JSON.stringify(totalsBefore)===JSON.stringify(totalsAfter));
 check('historical ledger, quotes, jobs, purchases remain unchanged',JSON.stringify(before)===JSON.stringify(await fingerprint(db,true)));
 await reject(db,'workspace account is immutable',()=>db.query('UPDATE workspaces SET billing_account_id=$1 WHERE id=$2',[account(c),a]));
 await reject(db,'direct account balance edit is forbidden',()=>db.query('UPDATE billing_account_wallets SET available_tokens=1 WHERE billing_account_id=$1',[account(a)]));
 await reject(db,'ledger remains append-only',()=>db.query('UPDATE token_ledger_entries SET available_delta=1 WHERE workspace_id=$1',[a]));
 await reject(db,'mismatched quote account rejected by database',()=>db.query("INSERT INTO billing_quotes(workspace_id,billing_account_id,created_by,operation,price_version_id,request_hash,input_hash,input_snapshot,token_amount,quote_hash,expires_at) VALUES($1,$2,$3,'AI_VIDEO',$4,$5,$5,'{}',100,$5,now()+interval '1 minute')",[a,account(c),x,version,'c'.repeat(64)]));
 await reject(db,'new account key cannot be duplicated across brands',async()=>{await grant(db,a,x,'1','future-account-key');await grant(db,b,x,'1','future-account-key');});
 proof={before:totalsBefore,after:totalsAfter,sharedAccount:{available:'9000',reserved:'1160'},historicalFingerprints:before,workspaceCount:4,accountCount:balances.length,historicalKeysPreserved:true};
 }finally{await db.end();}
}catch(error){exitCode=1;console.log(JSON.stringify({status:'FAIL',stage,constraint:error.constraint,code:/^[0-9A-Z]{5}$/.test(error.code||'')?error.code:'ISOLATED_MIGRATION_CHECK_FAILED'}));}
finally{for(const name of owned)try{await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');}catch{exitCode=1;}await admin.end();}
const result={status:exitCode?'FAIL':'PASS',migration,migrationSha256:createHash('sha256').update(sql).digest('hex'),tests:rows.length,rows,proof,cleanup:{ownedDatabasesDropped:owned.length},paid:{realVideo:0,realLLM:0,outreach:0,payments:0}};
await mkdir('docs/phase-c-evidence',{recursive:true});await writeFile('docs/phase-c-evidence/migration.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exitCode=exitCode;
