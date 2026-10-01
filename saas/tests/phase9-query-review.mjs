import pg from 'pg';
import {mkdir,writeFile} from 'node:fs/promises';
process.loadEnvFile('.env.local');
const selected=process.env.TEST_DATABASE_URL;
if(!selected||selected===process.env.DATABASE_URL)throw new Error('Distinct TEST database required');
const db=new pg.Client({connectionString:selected,connectionTimeoutMillis:5000,statement_timeout:15000});
await db.connect();
try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const counts={};for(const table of ['workspaces','products','jobs','workflow_runs','token_ledger_entries','payments','content_items','worker_leases'])counts[table]=Number((await db.query(`SELECT count(*)::text AS n FROM ${table}`)).rows[0].n);
  const workspace=(await db.query('SELECT workspace_id FROM jobs GROUP BY workspace_id ORDER BY count(*) DESC,workspace_id LIMIT 1')).rows[0]?.workspace_id;
  if(!workspace)throw new Error('Existing deterministic fixture rows required');
  const queries=[
    ['products','SELECT id FROM products WHERE workspace_id=$1 AND status=\'ACTIVE\' ORDER BY updated_at DESC,id DESC LIMIT 50',[workspace]],
    ['jobs','SELECT id FROM jobs WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',[workspace]],
    ['dueJobs',"SELECT id FROM job_outbox WHERE status='PENDING' AND available_at<=now() ORDER BY available_at,created_at,id LIMIT 25",[]],
    ['dueWorkflows',"SELECT id FROM workflow_runs WHERE status NOT IN('SUCCEEDED','FAILED','CANCELLED') AND next_reconcile_at<=now() ORDER BY next_reconcile_at,id LIMIT 25",[]],
    ['ledgerHistory','SELECT id FROM token_ledger_entries WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 51',[workspace]],
    ['paymentHistory','SELECT id FROM payments WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 51',[workspace]],
    ['paymentReconciliation',"SELECT id FROM payments WHERE status IN('CREATING','PENDING','EXPIRED') AND (external_id IS NOT NULL OR provider='fake') ORDER BY updated_at,id LIMIT 10",[]],
    ['contentPublication',"SELECT job_id FROM content_publications WHERE status='PENDING' AND available_at<=now() ORDER BY available_at,job_id LIMIT 10",[]],
    ['workerLeases',"SELECT id FROM worker_leases WHERE status='ACTIVE' AND expires_at<=now() ORDER BY expires_at,id LIMIT 25",[]],
    ['reviewQueue',"SELECT id FROM content_items WHERE workspace_id=$1 AND status='PENDING_REVIEW' ORDER BY created_at DESC,id DESC LIMIT 50",[workspace]],
  ];
  const results=[];
  for(const [name,sql,values] of queries){const document=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,values)).rows[0]['QUERY PLAN'][0],nodes=[];const walk=node=>{nodes.push({node:node['Node Type'],relation:node['Relation Name']||null,index:node['Index Name']||null,rows:node['Actual Rows'],rowsRemoved:node['Rows Removed by Filter']||0});for(const child of node.Plans||[])walk(child);};walk(document.Plan);results.push({name,planningMs:document['Planning Time'],executionMs:document['Execution Time'],returnedRows:document.Plan['Actual Rows'],nodes});}
  await db.query('COMMIT');
  const report={passed:true,mode:'read_only_test_database',counts,scope:'largest existing job workspace; global bounded due queues',queries:results,maximumQueryMs:Math.max(...results.map(r=>r.executionMs)),heavyLoadTest:false};
  await mkdir('data/phase9',{recursive:true});await writeFile('data/phase9/query-review.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,counts,queries:results.length,maximumQueryMs:report.maximumQueryMs}));
}catch(error){await db.query('ROLLBACK').catch(()=>{});throw error;}finally{await db.end();}
