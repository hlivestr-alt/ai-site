import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,stat,realpath,open,lstat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import pg from 'pg';
import {CreateBucketCommand,HeadBucketCommand,PutPublicAccessBlockCommand,PutBucketCorsCommand,PutObjectCommand,GetObjectCommand,HeadObjectCommand} from '@aws-sdk/client-s3';
import {storageClient,storageBucket} from './storage';
import {boundedSetting} from './operational-config';

type BackupObject={workspaceId:string;objectId:string;category:string;key:string;file:string;bytes:number;sha256:string;mimeType:string};
export type BackupManifest={version:1;id:string;completedAt:string;appVersion:string;databaseName:string;bucket:string;snapshot:string;migrations:{name:string;sha256:string}[];dump:{file:string;bytes:number;sha256:string};objects:BackupObject[];objectBytes:number};
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
async function checksum(path:string){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
async function backupPath(directory:string,newDirectory=false){
  const root=resolve(process.env.BACKUP_ROOT||join(process.cwd(),'data','backups'));await mkdir(root,{recursive:true,mode:0o700});
  const target=resolve(directory),rel=relative(root,target);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Backup directory must be a child of BACKUP_ROOT');
  // Existing ancestors must resolve under the same root, including on Windows junctions.
  let ancestor=dirname(target);for(;;){try{await stat(ancestor);break;}catch{const parent=dirname(ancestor);if(parent===ancestor)throw new Error('Backup parent unavailable');ancestor=parent;}}
  const actualRoot=await realpath(root),actualParent=await realpath(ancestor),actualRel=relative(actualRoot,actualParent);if(actualRel.startsWith('..')||isAbsolute(actualRel))throw new Error('Backup parent escaped its root');
  if(newDirectory)await mkdir(target,{recursive:false,mode:0o700});else{const real=await realpath(target),r=relative(actualRoot,real);if(!r||r.startsWith('..')||isAbsolute(r))throw new Error('Backup path escaped its root');}
  return target;
}
async function postgresTool(tool:'pg_dump'|'pg_restore',url:string,args:string[],output?:string,input?:string){
  const u=new URL(url),container=process.env.POSTGRES_TOOLS_CONTAINER,env={...process.env,PGHOST:container?(process.env.POSTGRES_TOOLS_HOST||'127.0.0.1'):u.hostname,PGPORT:container?(process.env.POSTGRES_TOOLS_PORT||'5432'):u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:decodeURIComponent(u.pathname.slice(1)),PGCONNECT_TIMEOUT:'5',PGSSLMODE:u.searchParams.get('sslmode')||'prefer'};
  if(container&&!/^[A-Za-z0-9_.-]{1,100}$/.test(container))throw new Error('Invalid Postgres tools container');
  const bin=container?'docker':process.env[tool==='pg_dump'?'PG_DUMP_PATH':'PG_RESTORE_PATH']||tool;
  const argv=container?['exec','-i',...['PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGCONNECT_TIMEOUT','PGSSLMODE'].flatMap(n=>['--env',n]),container,tool,...args]:args;
  const child=spawn(bin,argv,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.resume();
  const completion=new Promise<void>((yes,no)=>{child.on('error',()=>no(new Error('Postgres tool unavailable')));child.on('close',code=>code===0?yes():no(new Error('Postgres backup tool failed')));});
  const flows:Promise<unknown>[]=[completion];if(output)flows.push(pipeline(child.stdout,createWriteStream(output,{flags:'wx',mode:0o600})));else child.stdout.resume();if(input)flows.push(pipeline(createReadStream(input),child.stdin));else child.stdin.end();
  try{await Promise.all(flows);}catch(error){child.kill();await Promise.allSettled(flows);throw error;}
}
export async function createBackup(directory:string){
  const path=await backupPath(directory,true),url=process.env.DATABASE_URL;if(!url)throw new Error('Database configuration required');
  const db=new pg.Client({connectionString:url,connectionTimeoutMillis:5000,statement_timeout:300000}),s3=storageClient(),bucket=storageBucket();
  let tx=false,connected=false;
  try{
    await mkdir(join(path,'objects'),{mode:0o700});await db.connect();connected=true;
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');tx=true;
    const snapshot=(await db.query<{snapshot:string}>('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const migrations=(await db.query<{name:string;sha256:string}>('SELECT name,sha256 FROM schema_migrations ORDER BY name')).rows;
    if(!migrations.at(-1)?.name.startsWith('0009_'))throw new Error('Phase 9 migrations required');
    const maximum=boundedSetting('BACKUP_MAX_OBJECTS',100000,1,1000000),refs=(await db.query<{workspace_id:string;object_id:string;category:string;storage_key:string;byte_size:string|null;sha256:string|null;mime_type:string}>('SELECT * FROM workspace_storage_objects ORDER BY workspace_id,storage_key LIMIT $1',[maximum+1])).rows;
    if(refs.length>maximum)throw new Error('Backup inventory exceeds configured bound');
    const dumpPath=join(path,'database.dump');await postgresTool('pg_dump',url,['--format=custom','--no-owner','--no-acl',`--snapshot=${snapshot}`],dumpPath);
    const objects:BackupObject[]=[];
    for(const ref of refs){
      if(!ref.storage_key.startsWith(`workspaces/${ref.workspace_id}/`))throw new Error('Invalid sealed object reference');
      const file=`${digest(ref.storage_key)}.bin`,target=join(path,'objects',file),r=await s3.send(new GetObjectCommand({Bucket:bucket,Key:ref.storage_key}));if(!r.Body||!(Symbol.asyncIterator in r.Body))throw new Error('Backup object unavailable');
      const output=await open(target,'wx',0o600),hash=createHash('sha256');let bytes=0;
      try{for await(const chunk of r.Body as AsyncIterable<Uint8Array>){bytes+=chunk.length;hash.update(chunk);if(ref.byte_size!==null&&bytes>Number(ref.byte_size))throw new Error('Backup object size mismatch');let offset=0;while(offset<chunk.length){const result=await output.write(chunk,offset,chunk.length-offset);if(!result.bytesWritten)throw new Error('Backup disk write failed');offset+=result.bytesWritten;}}}finally{await output.close();}
      const sha256=hash.digest('hex');if(ref.byte_size!==null&&bytes!==Number(ref.byte_size)||ref.sha256&&sha256!==ref.sha256)throw new Error('Backup object identity mismatch');
      objects.push({workspaceId:ref.workspace_id,objectId:ref.object_id,category:ref.category,key:ref.storage_key,file,bytes,sha256,mimeType:ref.mime_type||'application/octet-stream'});
    }
    await db.query('COMMIT');tx=false;
    const appVersion=String(JSON.parse(await readFile(join(process.cwd(),'package.json'),'utf8')).version);
    const manifest:BackupManifest={version:1,id:randomUUID(),completedAt:new Date().toISOString(),appVersion,databaseName:decodeURIComponent(new URL(url).pathname.slice(1)),bucket,snapshot,migrations,dump:{file:'database.dump',bytes:(await stat(dumpPath)).size,sha256:await checksum(dumpPath)},objects,objectBytes:objects.reduce((n,o)=>n+o.bytes,0)};
    const encoded=JSON.stringify(manifest,null,2);await writeFile(join(path,'manifest.json'),encoded,{flag:'wx',mode:0o600});await writeFile(join(path,'manifest.sha256'),digest(encoded)+'\n',{flag:'wx',mode:0o600});
    await db.query('INSERT INTO backup_records(id,migration_version,dump_sha256,object_count,object_bytes,manifest_name) VALUES($1,$2,$3,$4,$5,$6)',[manifest.id,migrations.at(-1)!.name,manifest.dump.sha256,objects.length,manifest.objectBytes,manifest.id+'.json']);
    return {id:manifest.id,objects:objects.length,objectBytes:manifest.objectBytes,dumpSha256:manifest.dump.sha256,complete:true};
  }catch(error){if(tx)await db.query('ROLLBACK').catch(()=>{});await writeFile(join(path,'INCOMPLETE.json'),JSON.stringify({code:'BACKUP_INCOMPLETE',time:new Date().toISOString()}),{mode:0o600}).catch(()=>{});throw error;}finally{if(connected)await db.end();s3.destroy();}
}
export async function verifyBackup(directory:string){
  const path=await backupPath(directory);let incomplete=false;try{await lstat(join(path,'INCOMPLETE.json'));incomplete=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}if(incomplete)throw new Error('Backup is incomplete');
  const encoded=await readFile(join(path,'manifest.json'),'utf8');if((await readFile(join(path,'manifest.sha256'),'utf8')).trim()!==digest(encoded))throw new Error('Backup manifest checksum mismatch');const m=JSON.parse(encoded) as BackupManifest;
  if(m.version!==1||m.dump.file!=='database.dump'||!Array.isArray(m.objects)||m.objects.length>1000000)throw new Error('Invalid backup manifest');
  if((await stat(join(path,m.dump.file))).size!==m.dump.bytes||await checksum(join(path,m.dump.file))!==m.dump.sha256)throw new Error('Backup database checksum mismatch');
  const keys=new Set<string>();for(const o of m.objects){if(!/^[a-f0-9]{64}\.bin$/.test(o.file)||o.file!==`${digest(o.key)}.bin`||!o.key.startsWith(`workspaces/${o.workspaceId}/`)||keys.has(o.key)||!Number.isSafeInteger(o.bytes)||o.bytes<0)throw new Error('Invalid backup object');keys.add(o.key);const p=join(path,'objects',o.file);if((await stat(p)).size!==o.bytes||await checksum(p)!==o.sha256)throw new Error('Backup object checksum mismatch');}
  if(m.objectBytes!==m.objects.reduce((n,o)=>n+o.bytes,0))throw new Error('Backup inventory sum mismatch');return {path,manifest:m};
}
export async function restoreBackup(directory:string){
  const {path,manifest:m}=await verifyBackup(directory),url=process.env.RESTORE_DATABASE_URL,bucket=process.env.RESTORE_OBJECT_STORAGE_BUCKET;if(!url||!bucket)throw new Error('Explicit restore targets required');const name=decodeURIComponent(new URL(url).pathname.slice(1));
  if(['postgres','template0','template1'].includes(name.toLowerCase())||process.env.RESTORE_CONFIRM_DATABASE!==name||process.env.RESTORE_CONFIRM_BUCKET!==bucket||name===m.databaseName||bucket===m.bucket||url===process.env.DATABASE_URL||bucket===process.env.OBJECT_STORAGE_BUCKET)throw new Error('Restore requires distinct confirmed targets');
  const db=new pg.Client({connectionString:url,connectionTimeoutMillis:5000}),s3=storageClient();await db.connect();
  try{
    const count=(await db.query<{n:string}>("SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN('pg_catalog','information_schema') AND n.nspname !~ '^pg_' AND c.relkind IN('r','v','m','S')")).rows[0].n;if(Number(count))throw new Error('Restore target database must be empty');
    let exists=true;try{await s3.send(new HeadBucketCommand({Bucket:bucket}));}catch(e){if(e&&typeof e==='object'&&'$metadata' in e&&(e.$metadata as {httpStatusCode?:number}).httpStatusCode===404)exists=false;else throw e;}if(exists)throw new Error('Restore bucket must be new');
    await s3.send(new CreateBucketCommand({Bucket:bucket}));await s3.send(new PutPublicAccessBlockCommand({Bucket:bucket,PublicAccessBlockConfiguration:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true}}));
    if(process.env.APP_BASE_URL)await s3.send(new PutBucketCorsCommand({Bucket:bucket,CORSConfiguration:{CORSRules:[{AllowedOrigins:[process.env.APP_BASE_URL],AllowedMethods:['GET','PUT','HEAD'],AllowedHeaders:['content-type','x-amz-*'],ExposeHeaders:['ETag'],MaxAgeSeconds:300}]}}));
    for(const o of m.objects){await s3.send(new PutObjectCommand({Bucket:bucket,Key:o.key,Body:createReadStream(join(path,'objects',o.file)),ContentLength:o.bytes,ContentType:o.mimeType}));const h=await s3.send(new HeadObjectCommand({Bucket:bucket,Key:o.key}));if(h.ContentLength!==o.bytes)throw new Error('Restored object size differs');}
    await postgresTool('pg_restore',url,['--single-transaction','--exit-on-error','--no-owner','--no-privileges','--dbname',name],undefined,join(path,m.dump.file));
    await db.query('INSERT INTO backup_records(id,migration_version,dump_sha256,object_count,object_bytes,manifest_name) VALUES($1,$2,$3,$4,$5,$6)',[m.id,m.migrations.at(-1)!.name,m.dump.sha256,m.objects.length,m.objectBytes,m.id+'.json']);
    return {id:m.id,objects:m.objects.length,restored:true,applicationVerification:'REQUIRED'};
  }finally{await db.end();s3.destroy();}
}
