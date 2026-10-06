// Private record hashes: never prints customer contents or connection strings.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import pg from 'pg';
const env=parseEnv(await readFile('.env.local','utf8'));
if(env.APP_BASE_URL!=='https://ai-test.proyaofficial.com')throw new Error('REMOTE-TEST configuration required');
const c=new pg.Client({connectionString:env.DATABASE_URL});await c.connect();
const file='.next-tests/phase-b/live-baseline.json',mode=process.argv[2];
const tables={jobs:'SELECT id,input_snapshot,input_hash FROM jobs ORDER BY id',media:"SELECT id,workspace_id,product_id,asset_id,version_number,status,storage_key,sha256,byte_size FROM asset_versions WHERE status='READY' ORDER BY id",information:'SELECT * FROM product_versions ORDER BY id',rules:'SELECT * FROM product_accuracy_rule_versions ORDER BY id'};
try{
 if(mode==='before'){const records={};for(const [name,sql] of Object.entries(tables))records[name]=(await c.query(sql)).rows.map(row=>({id:row.id,hash:createHash('sha256').update(JSON.stringify(row)).digest('hex')}));await mkdir('.next-tests/phase-b',{recursive:true});await writeFile(file,JSON.stringify(records));console.log(JSON.stringify({baselineSaved:true,counts:Object.fromEntries(Object.entries(records).map(([name,rows])=>[name,rows.length]))}));}
 else if(mode==='after'){const records=JSON.parse(await readFile(file,'utf8')),checks={};for(const [name,sql] of Object.entries(tables)){const now=new Map((await c.query(sql)).rows.map(row=>[row.id,createHash('sha256').update(JSON.stringify(row)).digest('hex')]));checks[name]={originalRows:records[name].length,unchanged:records[name].every(row=>now.get(row.id)===row.hash)};}await writeFile('docs/stabilization-phase-b-evidence/live-history-preservation.json',JSON.stringify(checks,null,2));console.log(JSON.stringify(checks));if(Object.values(checks).some(check=>!check.unchanged))process.exitCode=1;}
 else throw new Error('Use before|after');
}finally{await c.end();}
