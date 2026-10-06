import {randomUUID} from "node:crypto";
import {query,transaction} from "./db";
import {AppError,isUuid,audit} from "./core";
import {billingRealm,canonicalHash,lockWallet,issue} from "./billing-core";
import {paymentProvider,type PaymentEvent,type PaymentState} from "./payment-providers";

export type PaymentRow={id:string;billing_account_id:string;workspace_id:string;workspace_name?:string;created_by:string;package_version_id:string;token_amount:string;fiat_minor:string;currency:string;provider:"fake"|"xendit";provider_mode:string;reference_id:string;external_id:string|null;status:PaymentState|"CREATING";creation_attempted_at:Date|null;request_hash:string;checkout_url:string|null;expires_at:Date|null;creation_unknown:boolean;created_at:Date};
export function safePayment(p:PaymentRow){return {id:p.id,workspaceId:p.workspace_id,workspaceName:p.workspace_name,packageVersionId:p.package_version_id,tokenAmount:p.token_amount,fiatMinor:p.fiat_minor,currency:p.currency,status:p.status,checkoutUrl:p.checkout_url,expiresAt:p.expires_at,createdAt:p.created_at,simulation:p.provider==="fake",sandbox:p.provider_mode==="SANDBOX",needsSupport:p.creation_unknown};}
export async function processPaymentEvent(provider:"fake"|"xendit",event:PaymentEvent){return transaction(async db=>{
 const p=(await db.query<PaymentRow>(event.kind==="REFUND"?"SELECT p.* FROM payments p WHERE p.provider=$1 AND EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_id=p.id AND e.provider=p.provider AND e.safe_payload->>'providerRequestId'=$2 AND e.safe_payload->>'status'='PAID') FOR UPDATE":"SELECT * FROM payments WHERE provider=$1 AND reference_id=$2 FOR UPDATE",[provider,event.kind==="REFUND"?event.providerRequestId:event.referenceId])).rows[0];
 const hash=canonicalHash(event),prior=(await db.query<{payload_hash:string}>("SELECT payload_hash FROM payment_events WHERE provider=$1 AND event_key=$2",[provider,event.eventKey])).rows[0];
 if(prior){if(prior.payload_hash!==hash)await issue(db,"EVENT_IDENTITY_CONFLICT",p?.workspace_id||null,null,p?.id||null,event.eventKey);return {duplicate:true,credited:false};}
 let disposition="APPLIED",credited=false;
 if(!p){disposition="UNKNOWN_PAYMENT";await issue(db,disposition,null,null,null,event.eventKey);}
 else if(event.kind==="REFUND"){
  if(provider!=="xendit"||event.businessId!==process.env.XENDIT_BUSINESS_ID||p.currency!==event.currency||BigInt(event.fiatMinor)>BigInt(p.fiat_minor)){disposition="PAYMENT_IDENTITY_MISMATCH";await issue(db,disposition,p.workspace_id,null,p.id,event.eventKey);}
  else{await issue(db,event.refundOutcome==="FAILED"?"FIAT_REFUND_FAILED":"FIAT_REFUND_REQUIRES_SUPPORT",p.workspace_id,null,p.id,event.eventKey);if(event.refundOutcome==="SUCCEEDED"&&p.status==="PAID"&&p.fiat_minor===event.fiatMinor)await db.query("UPDATE payments SET status='REFUNDED',updated_at=now() WHERE id=$1",[p.id]);}
 }
 else if(p.fiat_minor!==event.fiatMinor||p.currency!==event.currency||(p.external_id&&p.external_id!==event.externalId)||(provider==="xendit"&&event.businessId!==process.env.XENDIT_BUSINESS_ID)) {disposition="PAYMENT_IDENTITY_MISMATCH";await issue(db,disposition,p.workspace_id,null,p.id,event.eventKey);}
 else {
  // Payment row then its wallet. Job accounting never locks a payment, so no reverse lock edge exists.
  await lockWallet(db,p.workspace_id);
  await db.query("UPDATE payments SET external_id=coalesce(external_id,$1),creation_unknown=false,updated_at=now() WHERE id=$2",[event.externalId,p.id]);
  if(event.status==="PAID"&&!['PAID','REFUNDED'].includes(p.status)){
   await db.query("UPDATE payments SET status='PAID' WHERE id=$1",[p.id]);
   const r=await db.query<{id:string}>("INSERT INTO token_ledger_entries(workspace_id,entry_type,available_delta,reserved_delta,payment_id,idempotency_key) VALUES($1,'PURCHASE',$2,0,$3,$4) RETURNING id",[p.workspace_id,p.token_amount,p.id,`payment:${p.id}:purchase`]);
   await db.query("UPDATE payments SET purchase_ledger_id=$1 WHERE id=$2",[r.rows[0].id,p.id]);credited=true;
   await audit(db,{workspaceId:p.workspace_id,type:"TOKENS_PURCHASED",targetType:"payment",targetId:p.id,metadata:{tokens:p.token_amount,provider}});
   await audit(db,{workspaceId:p.workspace_id,type:"PAYMENT_CONFIRMED",targetType:"payment",targetId:p.id});
  }else if(event.status==="REFUNDED"){
   await issue(db,"FIAT_REFUND_REQUIRES_SUPPORT",p.workspace_id,null,p.id);
   if(p.status==="PAID")await db.query("UPDATE payments SET status='REFUNDED' WHERE id=$1",[p.id]);else disposition="REFUND_WITHOUT_PURCHASE";
  }else if(!['PAID','REFUNDED'].includes(p.status))await db.query("UPDATE payments SET status=$1 WHERE id=$2",[event.status,p.id]);
 }
 // Raw secrets, customer PII, and browser-supplied workspace identifiers are never retained.
 await db.query("INSERT INTO payment_events(provider,event_key,payload_hash,payment_id,safe_payload,disposition) VALUES($1,$2,$3,$4,$5::jsonb,$6)",[provider,event.eventKey,hash,p?.id||null,JSON.stringify(event),disposition]);
 return {duplicate:false,credited,disposition};
 });}
export async function createPaymentRecord(args:{workspaceId:string;userId:string;email:string;packageVersionId:string;key:string},authorize:(db:import("./db").DbClient)=>Promise<unknown>){
 if(!isUuid(args.packageVersionId)||! /^[A-Za-z0-9:_-]{8,160}$/.test(args.key))throw new AppError(400,"Choose a package and stable request key.");
 const provider=paymentProvider(),requestHash=canonicalHash({packageVersionId:args.packageVersionId,provider:provider.name});
 const p=await transaction(async db=>{await authorize(db);await lockWallet(db,args.workspaceId);
  const prior=(await db.query<PaymentRow>("SELECT * FROM payments WHERE workspace_id=$1 AND request_key=$2",[args.workspaceId,args.key])).rows[0];if(prior){if(prior.request_hash!==requestHash)throw new AppError(409,"Payment request key was used for another package.");return prior;}
  const v=(await db.query<{id:string;token_amount:string;fiat_minor:string;currency:string}>("SELECT v.* FROM token_package_versions v JOIN token_packages p ON p.id=v.package_id AND p.active_version_id=v.id WHERE v.id=$1 AND p.realm=$2",[args.packageVersionId,billingRealm()])).rows[0];if(!v)throw new AppError(404,"Active package not found.");
  if(provider.name==="xendit"&&v.currency!=="IDR")throw new AppError(400,"Only IDR sandbox packages are supported by this adapter.");
  if(process.env.PAYMENTS_ENABLED==='0')throw new AppError(503,'Payments are temporarily unavailable.');
  const id=randomUUID();const created=(await db.query<PaymentRow>("INSERT INTO payments(id,workspace_id,created_by,package_version_id,token_amount,fiat_minor,currency,provider,provider_mode,reference_id,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",[id,args.workspaceId,args.userId,v.id,v.token_amount,v.fiat_minor,v.currency,provider.name,provider.mode,`topup_${id}`,args.key,requestHash])).rows[0];await audit(db,{workspaceId:args.workspaceId,actorUserId:args.userId,type:"PAYMENT_CREATED",targetType:"payment",targetId:id,metadata:{packageVersionId:v.id,provider:provider.name}});return created;
 });
 // Only one process claims the external create. An ambiguous timeout is held, never blindly retried.
 const claim=(await query<PaymentRow>("UPDATE payments SET creation_attempted_at=now() WHERE id=$1 AND status='CREATING' AND creation_attempted_at IS NULL RETURNING *",[p.id])).rows[0];
 if(claim){try{const created=await provider.createPayment({id:p.id,workspaceId:p.workspace_id,referenceId:p.reference_id,fiatMinor:p.fiat_minor,currency:p.currency,email:args.email});await processPaymentEvent(provider.name,created.event);await query("UPDATE payments SET checkout_url=$1,expires_at=$2,updated_at=now() WHERE id=$3",[created.checkoutUrl,created.expiresAt,p.id]);}
 catch{await transaction(async db=>{await db.query("UPDATE payments SET creation_unknown=true,updated_at=now() WHERE id=$1 AND status='CREATING'",[p.id]);await issue(db,"PAYMENT_CREATION_UNKNOWN",p.workspace_id,null,p.id);});}}
 return safePayment((await query<PaymentRow>("SELECT * FROM payments WHERE id=$1",[p.id])).rows[0]);
}
export async function paymentReconcileBatch(limit=10,stopping=()=>false){const rows=(await query<PaymentRow>("SELECT * FROM payments WHERE status IN('CREATING','PENDING','EXPIRED') AND (external_id IS NOT NULL OR provider='fake') ORDER BY updated_at,id LIMIT $1",[limit])).rows;let count=0;for(const p of rows){if(stopping())break;try{const event=await paymentProvider(p.provider).getPayment(p.external_id||`fake_${p.id}`);if(event.status!==p.status||!p.external_id){await processPaymentEvent(p.provider,event);count++;}await query("UPDATE payments SET updated_at=now() WHERE id=$1",[p.id]);}catch{await query("UPDATE payments SET updated_at=now() WHERE id=$1",[p.id]);}}return count;}
