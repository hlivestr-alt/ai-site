import {pool,query} from '../src/lib/db';
import {deliverMail,mailDeliveryBatch} from '../src/lib/mail-core';
import {readiness,storageAudit,operationalAudits} from '../src/lib/operations';
import {rateLimit} from '../src/lib/core';
async function main(){if(process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL)throw new Error('Isolated Phase 9 database required');const [command,arg]=process.argv.slice(2);
  if(command==='mail-failure'){process.env.ENABLE_TEST_MAIL_FAILURE='1';await deliverMail('phase9-retry@example.test','Verify your account','http://127.0.0.1:3200/verify?token=fixture-mail-retry');const row=(await query<{id:string;status:string;encrypted_payload:string}>('SELECT id,status,encrypted_payload FROM mail_deliveries WHERE recipient=$1 ORDER BY created_at DESC LIMIT 1',['phase9-retry@example.test'])).rows[0];if(row.status!=='PENDING'||row.encrypted_payload.includes('token'))throw new Error('Mail failure was unsafe');process.env.ENABLE_TEST_MAIL_FAILURE='0';await query('UPDATE mail_deliveries SET available_at=now() WHERE id=$1',[row.id]);await mailDeliveryBatch(1,row.id);console.log(JSON.stringify({mailId:row.id,status:(await query('SELECT status FROM mail_deliveries WHERE id=$1',[row.id])).rows[0].status}));}
  else if(command==='rate'){await rateLimit({query},'phase9-restart-rate',arg,1);console.log(JSON.stringify({accepted:true}));}
  else if(command==='readiness')console.log(JSON.stringify(await readiness()));
  else if(command==='storage')console.log(JSON.stringify(await storageAudit(arg)));
  else if(command==='audits')console.log(JSON.stringify(await operationalAudits()));
  else throw new Error('Unknown acceptance command');
}
main().catch(e=>{console.error(JSON.stringify({code:e.safeCode||'ACCEPTANCE_FAILURE',status:e.status||500,retryAfter:e.retryAfter||null}));process.exitCode=1;}).finally(()=>pool().end());
