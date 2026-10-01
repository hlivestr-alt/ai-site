import {query,transaction} from "./db";
import {issue,settlementBatch} from "./billing-core";
import {paymentReconcileBatch} from "./payments-core";
export async function reconciliationReport(repair=false){if(repair){await settlementBatch(100);await paymentReconcileBatch(50);}const checks:Record<string,string>={
 WALLET_LEDGER_MISMATCH:`SELECT w.workspace_id FROM workspace_wallets w LEFT JOIN token_ledger_entries l ON l.workspace_id=w.workspace_id GROUP BY w.workspace_id,w.available_tokens,w.reserved_tokens HAVING w.available_tokens<>coalesce(sum(l.available_delta),0) OR w.reserved_tokens<>coalesce(sum(l.reserved_delta),0)`,
 RESERVED_JOB_MISMATCH:`SELECT w.workspace_id FROM workspace_wallets w LEFT JOIN job_billing b ON b.workspace_id=w.workspace_id AND b.status='RESERVED' GROUP BY w.workspace_id,w.reserved_tokens HAVING w.reserved_tokens<>coalesce(sum(b.token_amount),0)`,
 TERMINAL_MISSING_SETTLEMENT:`SELECT b.workspace_id,b.job_id FROM job_billing b JOIN jobs j ON j.id=b.job_id WHERE b.status='RESERVED' AND j.status IN('SUCCEEDED','FAILED','CANCELLED')`,
 CAPTURE_WITHOUT_SUCCESS:`SELECT b.workspace_id,b.job_id FROM job_billing b JOIN jobs j ON j.id=b.job_id WHERE b.capture_ledger_id IS NOT NULL AND j.status<>'SUCCEEDED'`,
 PURCHASE_WITHOUT_PAID:`SELECT p.workspace_id,p.id AS payment_id FROM payments p JOIN token_ledger_entries l ON l.payment_id=p.id AND l.entry_type='PURCHASE' WHERE p.status NOT IN('PAID','REFUNDED')`,
 PAID_WITHOUT_PURCHASE:`SELECT p.workspace_id,p.id AS payment_id FROM payments p WHERE p.status IN('PAID','REFUNDED') AND NOT EXISTS(SELECT 1 FROM token_ledger_entries l WHERE l.payment_id=p.id AND l.entry_type='PURCHASE')`,
 PACKAGE_PAYMENT_MISMATCH:`SELECT p.workspace_id,p.id AS payment_id FROM payments p JOIN token_package_versions v ON v.id=p.package_version_id WHERE (p.token_amount,p.fiat_minor,p.currency) IS DISTINCT FROM(v.token_amount,v.fiat_minor,v.currency)`,
 LATE_SUCCESS_AFTER_RELEASE:`SELECT b.workspace_id,b.job_id FROM job_billing b JOIN jobs j ON j.id=b.job_id WHERE b.status='RELEASED' AND j.status='SUCCEEDED'`,
 };
 const result:Record<string,unknown[]>={};for(const [code,sql] of Object.entries(checks)){const rows=(await query<{workspace_id:string;job_id?:string;payment_id?:string}>(sql)).rows;result[code]=rows;for(const r of rows)await transaction(db=>issue(db,code,r.workspace_id,r.job_id||null,r.payment_id||null));}return result;
}
