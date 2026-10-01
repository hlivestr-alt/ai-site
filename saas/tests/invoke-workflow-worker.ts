import {request} from "@playwright/test";
import pg from "pg";
import {fixtureClips} from "./content-helpers";
import {worker} from "./clipper-helpers";

if(!process.env.TEST_DATABASE_URL||process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL||!process.env.TEST_OBJECT_STORAGE_BUCKET||process.env.OBJECT_STORAGE_BUCKET!==process.env.TEST_OBJECT_STORAGE_BUCKET)throw new Error("An isolated TEST database and bucket are required");
const [mode,workspaceId,jobId,sourceJson]=process.argv.slice(2);
async function main(){
if(mode==="claim"){
  const client=await worker(process.env.WORKFLOW_FIXTURE_WORKER_TOKEN!);
  const response=await client.post("/api/worker/claim",{data:{}});
  if(!response.ok())throw new Error("Fixture worker claim failed");
  const {claim}=await response.json();
  if(!claim)throw new Error("Fixture worker found no assigned job");
  const {jobId,attemptId,leaseId,fencingToken}=claim;
  process.stdout.write(JSON.stringify({jobId,attemptId,leaseId,fencingToken,inputSnapshot:{}})+"\n");
  // The parent terminates this actual process before it can publish an output.
  setInterval(()=>{},1000);
}else if(mode==="complete"){
  const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL}),client=await request.newContext();
  await db.connect();
  try{await fixtureClips(client,workspaceId,db,{jobId,source:JSON.parse(sourceJson)});}
  finally{await client.dispose();await db.end();}
}else throw new Error("Unsupported fixture worker mode");
}
main().catch(error=>{console.error(error);process.exit(1);});
