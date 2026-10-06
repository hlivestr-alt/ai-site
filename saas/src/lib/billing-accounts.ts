import {AppError,isUuid} from './core';
import {query,type DbClient} from './db';

export async function workspaceBillingAccount(workspaceId:string,db:DbClient={query}){
 if(!isUuid(workspaceId))throw new AppError(404,'Workspace not found.');
 const account=(await db.query<{billing_account_id:string;name:string}>('SELECT w.billing_account_id,a.name FROM workspaces w JOIN billing_accounts a ON a.id=w.billing_account_id WHERE w.id=$1',[workspaceId])).rows[0];
 if(!account)throw new AppError(404,'Billing account not found.');return account;
}
export async function canManageBilling(userId:string,workspaceId:string,db:DbClient={query}){
 return Boolean((await db.query("SELECT 1 FROM workspaces w JOIN billing_account_members m ON m.billing_account_id=w.billing_account_id JOIN users u ON u.id=m.user_id WHERE w.id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND u.status='ACTIVE'",[workspaceId,userId])).rowCount);
}
export async function requireBillingManager(userId:string,workspaceId:string,db:DbClient={query},lock=false){
 const account=await workspaceBillingAccount(workspaceId,db);
 const member=(await db.query<{role:'OWNER'|'MANAGER'}>("SELECT m.role FROM billing_account_members m JOIN users u ON u.id=m.user_id WHERE m.billing_account_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND u.status='ACTIVE'"+(lock?' FOR SHARE OF m,u':''),[account.billing_account_id,userId])).rows[0];
 if(!member)throw new AppError(403,'Billing account owner or manager permission is required.');return account;
}
