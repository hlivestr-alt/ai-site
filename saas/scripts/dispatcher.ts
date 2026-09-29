import { dispatchBatch, reconcileBatch } from "../src/lib/job-core";
import { pool } from "../src/lib/db";

const once=process.argv.includes("--once");
const pollMs=Math.max(200,Math.min(30000,Number(process.env.DISPATCHER_POLL_MS||1000)));
let stopping=false;
process.on("SIGINT",()=>{stopping=true;});
process.on("SIGTERM",()=>{stopping=true;});
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function main(){
  do {
    try {
      const reconciled=await reconcileBatch(25);
      const dispatched=await dispatchBatch(25);
      if(reconciled||dispatched)console.log(JSON.stringify({event:"dispatcher_tick",reconciled,dispatched}));
    } catch(error) {
      console.error(JSON.stringify({event:"dispatcher_error",code:error instanceof Error?error.name:"UNKNOWN"}));
      if(once)process.exitCode=1;
    }
    if(!once&&!stopping)await pause(pollMs);
  } while(!once&&!stopping);
  await pool().end();
}
void main();
