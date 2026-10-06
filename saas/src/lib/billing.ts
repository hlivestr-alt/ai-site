import "server-only";
import type {Session} from './auth';
import {query,transaction} from './db';
import {AppError,isUuid} from './core';
import {requireActiveWorkspace} from './products';
import {requireMembership} from './workspaces';
import {canManageBilling,requireBillingManager,workspaceBillingAccount} from './billing-accounts';
import {billingRealm} from './billing-core';
import {createPaymentRecord,safePayment,type PaymentRow,processPaymentEvent} from './payments-core';
import {fakePaymentsEnabled,paymentProvider} from './payment-providers';

function historyCursor(cursor?:string){
 if(!cursor)return {date:null,id:null};
 try{const p=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(typeof p.date!=='string'||!isUuid(String(p.id))||!Number.isFinite(Date.parse(p.date)))throw new Error();return {date:p.date as string,id:p.id as string};}
 catch{throw new AppError(400,'Invalid history cursor.');}
}
function nextCursor(rows:{id:string;cursor_time:string}[]){const last=rows.slice(0,50).at(-1);return rows.length>50&&last?Buffer.from(JSON.stringify({date:last.cursor_time,id:last.id})).toString('base64url'):null;}
export async function billingSummary(session:Session,workspaceId:string){
 await requireActiveWorkspace(session,workspaceId,'workspace:read');const account=await workspaceBillingAccount(workspaceId);
 const wallet=(await query<{available_tokens:string;reserved_tokens:string}>('SELECT available_tokens,reserved_tokens FROM billing_account_wallets WHERE billing_account_id=$1',[account.billing_account_id])).rows[0];
 return {billingAccountId:account.billing_account_id,accountName:account.name,availableTokens:wallet.available_tokens,reservedTokens:wallet.reserved_tokens,canManage:await canManageBilling(session.userId,workspaceId),test:billingRealm()==='TEST'};
}
export async function packages(session:Session,workspaceId:string){
 await requireActiveWorkspace(session,workspaceId,'workspace:read');await requireBillingManager(session.userId,workspaceId);
 return (await query<{id:string;label:string;token_amount:string;fiat_minor:string;currency:string}>('SELECT v.id,v.label,v.token_amount,v.fiat_minor,v.currency FROM token_packages p JOIN token_package_versions v ON v.id=p.active_version_id AND v.package_id=p.id WHERE p.realm=$1 ORDER BY v.token_amount,v.id',[billingRealm()])).rows;
}
export async function history(session:Session,workspaceId:string,cursor?:string){
 await requireActiveWorkspace(session,workspaceId,'workspace:read');const account=await workspaceBillingAccount(workspaceId),manage=await canManageBilling(session.userId,workspaceId),{date,id}=historyCursor(cursor);
 const rows=(await query<{id:string;entry_type:string;available_delta:string;reserved_delta:string;job_id:string|null;created_at:Date;cursor_time:string;workspace_id:string;workspace_name:string;can_open_job:boolean}>(`
 SELECT l.id,l.entry_type,l.available_delta,l.reserved_delta,l.job_id,l.created_at,l.workspace_id,w.name AS workspace_name,
 EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=l.workspace_id AND m.user_id=$6 AND m.status='ACTIVE' AND w.status='ACTIVE') AS can_open_job,
 to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
 FROM token_ledger_entries l JOIN workspaces w ON w.id=l.workspace_id
 WHERE l.billing_account_id=$1 AND ($5::boolean OR l.workspace_id=$4) AND ($2::timestamptz IS NULL OR (l.created_at,l.id)<($2::timestamptz,$3::uuid)) ORDER BY l.created_at DESC,l.id DESC LIMIT 51`,[account.billing_account_id,date,id,workspaceId,manage,session.userId])).rows;
 return {entries:rows.slice(0,50),nextCursor:nextCursor(rows),scope:manage?'ACCOUNT':'WORKSPACE'};
}
export async function usage(session:Session,workspaceId:string){
 await requireActiveWorkspace(session,workspaceId,'workspace:read');return (await query<{job_id:string;type:string;token_amount:string;status:string;created_at:Date}>('SELECT b.job_id,j.type,b.token_amount,b.status,b.created_at FROM job_billing b JOIN jobs j ON j.id=b.job_id AND j.workspace_id=b.workspace_id WHERE b.workspace_id=$1 ORDER BY b.created_at DESC,b.job_id DESC LIMIT 50',[workspaceId])).rows;
}
export async function paymentHistory(session:Session,workspaceId:string,cursor?:string){
 await requireActiveWorkspace(session,workspaceId,'workspace:read');const account=await requireBillingManager(session.userId,workspaceId),{date,id}=historyCursor(cursor);
 const rows=(await query<PaymentRow&{cursor_time:string}>(`SELECT p.*,w.name AS workspace_name,to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM payments p JOIN workspaces w ON w.id=p.workspace_id WHERE p.billing_account_id=$1 AND ($2::timestamptz IS NULL OR (p.created_at,p.id)<($2::timestamptz,$3::uuid)) ORDER BY p.created_at DESC,p.id DESC LIMIT 51`,[account.billing_account_id,date,id])).rows;
 return {payments:rows.slice(0,50).map(safePayment),nextCursor:nextCursor(rows)};
}
export async function customerCreatePayment(session:Session,workspaceId:string,raw:Record<string,unknown>){
 await requireActiveWorkspace(session,workspaceId,'workspace:read');await requireBillingManager(session.userId,workspaceId);
 return createPaymentRecord({workspaceId,userId:session.userId,email:session.email,packageVersionId:String(raw.packageVersionId||''),key:String(raw.idempotencyKey||'')},async db=>{await requireMembership(session.userId,workspaceId,db);await requireBillingManager(session.userId,workspaceId,db,true);});
}
export async function simulatePayment(session:Session,workspaceId:string,id:string,raw:Record<string,unknown>){
 if(!fakePaymentsEnabled())throw new AppError(404,'Not found.');await requireActiveWorkspace(session,workspaceId,'workspace:read');
 if(!isUuid(id)||!['PENDING','PAID','FAILED','EXPIRED','REFUNDED'].includes(String(raw.status)))throw new AppError(400,'Invalid simulation.');
 const p=await transaction(async db=>{const account=await requireBillingManager(session.userId,workspaceId,db,true);
 const p=(await db.query<PaymentRow>("SELECT * FROM payments WHERE billing_account_id=$1 AND id=$2 AND provider='fake' FOR UPDATE",[account.billing_account_id,id])).rows[0];
 if(!p?.external_id)throw new AppError(404,'Simulation payment not found.');await db.query('UPDATE fake_payment_states SET status=$1,updated_at=now() WHERE external_id=$2',[raw.status,p.external_id]);return p;});
 if(raw.deliverWebhook!==false)await processPaymentEvent('fake',await paymentProvider('fake').getPayment(p.external_id!));return {simulation:true};
}
