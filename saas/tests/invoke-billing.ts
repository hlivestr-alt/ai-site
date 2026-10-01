import {pool} from "../src/lib/db";
import {settleJob,settlementBatch,supportEntry} from "../src/lib/billing-core";
import {paymentReconcileBatch} from "../src/lib/payments-core";
import {reconciliationReport} from "../src/lib/billing-reconciliation";
const [command,...args]=process.argv.slice(2);
async function main(){if(process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL)throw new Error("Only isolated tests may invoke this fixture helper");let r:unknown;if(command==="settle")r=await settleJob(args[0],args[1]);else if(command==="settle-batch")r=await settlementBatch(100);else if(command==="payments")r=await paymentReconcileBatch(100);else if(command==="report")r=await reconciliationReport(args[0]==="repair");else if(command==="refund")r=await supportEntry({workspaceId:args[0],operatorId:args[1],jobId:args[2],key:args[3],reason:args[4],type:"REFUND"});else throw new Error("Invalid fixture invocation");console.log(JSON.stringify(r));}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool().end());
