import {pool} from "../src/lib/db";
import {workflowBatch} from "../src/lib/workflow-core";
const once=process.argv.includes("--once"),poll=Number(process.env.WORKFLOW_POLL_MS||1000);
if(!Number.isInteger(poll)||poll<200||poll>30000)throw new Error("WORKFLOW_POLL_MS must be 200–30000");
let stopping=false;process.on("SIGINT",()=>{stopping=true;});process.on("SIGTERM",()=>{stopping=true;});
async function main(){do{try{const reconciled=await workflowBatch(25);if(reconciled)console.log(JSON.stringify({event:"workflow_tick",reconciled}));}catch(error){console.error(JSON.stringify({event:"workflow_error",code:error instanceof Error?error.name:"UNKNOWN"}));if(once)process.exitCode=1;}if(!once&&!stopping)await new Promise(resolve=>setTimeout(resolve,poll));}while(!once&&!stopping);}
main().finally(()=>pool().end());
