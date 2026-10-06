// Explicit fixture funding, never called by application code or workspace creation.
import pg from "pg";
import {execFileSync} from "node:child_process";
process.loadEnvFile(".env.local");
const [workspaceId,amount="100000"]=process.argv.slice(2);
if(!process.env.TEST_DATABASE_URL)throw new Error("Isolated test database required");
const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
try{const operator=(await db.query("SELECT created_by,billing_account_id FROM workspaces WHERE id=$1",[workspaceId])).rows[0]?.created_by;const account=(await db.query('SELECT billing_account_id FROM workspaces WHERE id=$1',[workspaceId])).rows[0]?.billing_account_id;if(!operator||!account)throw new Error("Test workspace missing");execFileSync(process.execPath,["--import","tsx","scripts/billing-support.ts","grant",account,workspaceId,operator,`fixture:${workspaceId}:${amount}`,amount,"Explicit regression fixture grant"],{env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,ENABLE_BILLING_SUPPORT_CLI:"1"},stdio:"pipe",windowsHide:true});}finally{await db.end();}
