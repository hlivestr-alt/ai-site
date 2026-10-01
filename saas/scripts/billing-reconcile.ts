import {reconciliationReport} from "../src/lib/billing-reconciliation";
import {pool,query,transaction} from "../src/lib/db";
import {allowlistedOperator} from '../src/lib/platform-access';
import {audit,isUuid} from '../src/lib/core';
async function main(){
  const repair=process.argv.includes('--repair-safe'),strict=!['local','test'].includes(process.env.APP_ENV||''),actor=process.env.OPERATOR_USER_ID,reason=process.env.OPERATOR_REASON;
  if(repair&&strict){
    if(!isUuid(actor||'')||!reason||reason.trim().length<8||reason.length>240)throw new Error('Explicit operator and reason required');
    const user=(await query<{id:string;email:string}>("SELECT id,email FROM users WHERE id=$1 AND status='ACTIVE'",[actor])).rows[0];if(!user||!allowlistedOperator(user))throw new Error('Allowlisted operator required');
    await transaction(db=>audit(db,{actorUserId:actor,type:'BILLING_RECONCILIATION_REQUESTED',targetType:'billing_reconciliation',metadata:{reason:reason.trim()}}));
  }
  const result=await reconciliationReport(repair);
  if(repair&&strict)await transaction(db=>audit(db,{actorUserId:actor,type:'BILLING_RECONCILIATION_COMPLETED',targetType:'billing_reconciliation',metadata:{reason:reason!.trim()}}));
  console.log(JSON.stringify(result,null,2));
}
main().catch(()=>{console.error(JSON.stringify({code:'BILLING_AUDIT_UNAVAILABLE'}));process.exitCode=1;}).finally(()=>pool().end());
