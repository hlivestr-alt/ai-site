import {readFile,writeFile,mkdir} from 'node:fs/promises';
import pg from 'pg';
import {owner} from '../clipper-helpers';
import {product,videoJob,settle,fixtureClips,publishJob,posters} from '../content-helpers';
import {login} from './browser-checks';
export {observe,mediaChecks,login} from './browser-checks';
export const base=process.env.SAAS_TEST_BASE_URL!;
export async function database(){const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();return db;}
export async function evidence(name:string,data:unknown){const directory=process.env.STABILIZATION_EVIDENCE_DIR||'docs/stabilization-phase-a-evidence';await mkdir(directory,{recursive:true});await writeFile(`${directory}/${name}.json`,JSON.stringify({runId:process.env.STABILIZATION_RUN_ID,...data as Record<string,unknown>},null,2));}
export async function fixtures(){
  const file='test-data/stabilization-phase-a/fixtures.json';
  try{const f=JSON.parse(await readFile(file,'utf8'));if(f.runId===process.env.STABILIZATION_RUN_ID)return f;}catch{}
  const email=`phase-a-${process.env.STABILIZATION_RUN_ID}@example.test`,a=await owner(email),b=await owner(`phase-a-other-${process.env.STABILIZATION_RUN_ID}@example.test`,false);
  try{const p=await product(a.c,a.workspaceId);const f={runId:process.env.STABILIZATION_RUN_ID,email,otherEmail:`phase-a-other-${process.env.STABILIZATION_RUN_ID}@example.test`,workspaceId:a.workspaceId,otherWorkspaceId:b.workspaceId,productId:p.id,assetId:p.reference.assetId,versionId:p.reference.versionId};await writeFile(file,JSON.stringify(f,null,2));return f;}finally{await a.c.dispose();await b.c.dispose();}
}
export async function populatedFixtures(){
  const f=await fixtures();if(f.aiJobId)return f;
  const c=await login(f.email),db=await database();
  try{const id=await videoJob(c,f.workspaceId,f.productId);await settle(db,id);const clips=await fixtureClips(c,f.workspaceId,db);const aiContentId=publishJob(f.workspaceId,id)[0][0],clipContentIds=publishJob(f.workspaceId,clips.jobId)[0];posters();const full={...f,aiJobId:id,clipJobId:clips.jobId,sourceId:clips.source.id,aiContentId,clipContentIds};await writeFile('test-data/stabilization-phase-a/fixtures.json',JSON.stringify(full,null,2));return full;}finally{await c.dispose();await db.end();}
}
