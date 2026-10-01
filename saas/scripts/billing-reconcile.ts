import {reconciliationReport} from "../src/lib/billing-reconciliation";
import {pool} from "../src/lib/db";
reconciliationReport(process.argv.includes("--repair-safe")).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.name);process.exitCode=1;}).finally(()=>pool().end());
