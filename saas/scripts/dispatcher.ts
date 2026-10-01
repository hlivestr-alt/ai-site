import { dispatchBatch, reconcileBatch } from "../src/lib/job-core";
import { pool } from "../src/lib/db";
import { providerBatch, reserveProviderBatch } from "../src/lib/provider-core";
import {contentPublicationBatch} from "../src/lib/content-publication";
import {contentPosterBatch} from "../src/lib/content-posters";

import {settlementBatch} from "../src/lib/billing-core";
import {paymentReconcileBatch} from "../src/lib/payments-core";

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
      const providerReserved=await reserveProviderBatch(10);
      const providerActions=await providerBatch(20);
      const tokensSettled=await settlementBatch(25);
      const paymentsReconciled=await paymentReconcileBatch(10);
      const contentPublished=await contentPublicationBatch(10);
      const postersCreated=await contentPosterBatch(2);
      if(tokensSettled||paymentsReconciled||reconciled||dispatched||providerReserved||providerActions||contentPublished||postersCreated)console.log(JSON.stringify({event:"dispatcher_tick",tokensSettled,paymentsReconciled,reconciled,dispatched,providerReserved,providerActions,contentPublished,postersCreated}));
    } catch(error) {
      console.error(JSON.stringify({event:"dispatcher_error",code:error instanceof Error?error.name:"UNKNOWN"}));
      if(once)process.exitCode=1;
    }
    if(!once&&!stopping)await pause(pollMs);
  } while(!once&&!stopping);
  await pool().end();
}
void main();
