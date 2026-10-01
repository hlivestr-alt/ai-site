import {pool} from "../src/lib/db";
import {reconcileWorkflowOne} from "../src/lib/workflow-core";
async function main(){
  if(process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL)throw new Error("Only the isolated test database may invoke this helper");
  const [id,admissions="2",crash,repeats="1"]=process.argv.slice(2);
  let reconciled=0;for(let index=0;index<Math.min(200,Number(repeats));index++)if(await reconcileWorkflowOne({runId:id,admissions:Number(admissions),fault:crash?async point=>{if(point===crash)process.exit(86);}:undefined}))reconciled++;console.log(JSON.stringify({reconciled}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool().end());
