import {createHash,randomUUID} from "node:crypto";
import {AppError,audit,isUuid} from "./core";
import {query,transaction,type DbClient} from "./db";
import {inputHash,type JobInput} from "./job-core";
import {allowlistedOperator} from './platform-access';
import {nonProductionTestAllowed} from './operational-config';
import {workspaceBillingAccount} from './billing-accounts';

export type Operation="AI_VIDEO"|"CLIPPER"|'CLIPPER_VARIATION'|'OUTREACH';
export function billingRealm(){return ['local','test'].includes(process.env.APP_ENV||'')&&process.env.ENABLE_TEST_BILLING==="1"?"TEST":"PRODUCTION";}
export function integer(value:unknown,positive=false){if(typeof value!=="string"||! /^(0|[1-9][0-9]{0,15})$/.test(value))throw new AppError(400,"Use an integer decimal amount.");const n=BigInt(value);if(n>BigInt(9007199254740991)||positive&&n<=BigInt(0))throw new AppError(400,"Invalid amount.");return n;}
export function canonicalHash(value:unknown):string{function sorted(v:unknown):unknown{if(Array.isArray(v))return v.map(sorted);if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sorted(x)]));return v;}return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");}
export function calculateTokens(operation:Operation,input:JobInput,rules:Record<string,unknown>){
 if(operation==="AI_VIDEO"&&input.kind==="AI_VIDEO"){if(rules.tier!==input.tier)throw new AppError(503,"No price is configured for this tier.");return (integer(rules.base)+integer(rules.perSecond)*BigInt(input.durationSeconds))*BigInt(input.quantity);}
 if(operation==="CLIPPER"&&input.kind==="CLIPPER")return integer(rules.base)+integer(rules.perClip)*BigInt(input.targetClipCount)+(input.captions?integer(rules.captions):BigInt(0));
 if(operation==='CLIPPER_VARIATION'&&input.kind==='CLIPPER_VARIATION'){if(rules.policyVersion!==input.variationPolicyVersion||rules.approval!=='INTERNAL_BETA'||typeof rules.maxDurationSeconds!=='number'||!Number.isFinite(rules.maxDurationSeconds)||rules.maxDurationSeconds<1||rules.maxDurationSeconds>90||input.lineage.clip.duration>Number(rules.maxDurationSeconds))throw new AppError(503,'This variation price is unavailable.');return integer(rules.perRender,true);}
 throw new AppError(400,"Unsupported priced operation.");
}
export type Quote={id:string;workspace_id:string;billing_account_id:string;operation:Operation;price_version_id:string;request_hash:string;input_hash:string;token_amount:string;quote_hash:string;expires_at:Date};
export async function lockWallet(db:DbClient,workspaceId:string){const r=await db.query<{billing_account_id:string;available_tokens:string;reserved_tokens:string}>("SELECT a.billing_account_id,a.available_tokens,a.reserved_tokens FROM billing_account_wallets a JOIN workspaces w ON w.billing_account_id=a.billing_account_id WHERE w.id=$1 FOR UPDATE OF a",[workspaceId]);if(!r.rows[0])throw new AppError(404,"Account wallet not found.");return r.rows[0];}
export async function createQuote(db:DbClient,workspaceId:string,userId:string,operation:Operation,input:JobInput,requestHash:string){
 const version=(await db.query<{id:string;rules:Record<string,unknown>;label:string}>("SELECT v.id,v.rules,v.label FROM price_catalogs c JOIN price_versions v ON v.id=c.active_version_id AND v.catalog_id=c.id WHERE c.operation=$1 AND c.realm=$2",[operation,billingRealm()])).rows[0];
 if(!version)throw new AppError(503,"No active token price is configured.");
 const amount=calculateTokens(operation,input,version.rules);if(amount<=BigInt(0)||amount>BigInt(9007199254740991))throw new AppError(503,"Invalid configured price.");
 const ttl=Number(process.env.BILLING_QUOTE_TTL_MINUTES||15);if(!Number.isInteger(ttl)||ttl<10||ttl>30)throw new AppError(503,"Quote expiry configuration is invalid.");
 const account=await workspaceBillingAccount(workspaceId,db),billingAccountId=account.billing_account_id;
 const id=randomUUID(),expires=new Date(Date.now()+ttl*60000),hash=inputHash(input),quoteHash=canonicalHash({id,workspaceId,billingAccountId,operation,requestHash,inputHash:hash,priceVersionId:version.id,tokenAmount:amount.toString(),expiresAt:expires.toISOString()});
 await db.query("INSERT INTO billing_quotes(id,workspace_id,created_by,operation,price_version_id,request_hash,input_hash,input_snapshot,token_amount,quote_hash,expires_at,billing_account_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)",[id,workspaceId,userId,operation,version.id,requestHash,hash,JSON.stringify(input),amount.toString(),quoteHash,expires,billingAccountId]);
 const wallet=(await db.query<{available_tokens:string;reserved_tokens:string}>("SELECT available_tokens,reserved_tokens FROM billing_account_wallets WHERE billing_account_id=$1",[billingAccountId])).rows[0];
 return {id,billingAccountId,operation,priceVersionId:version.id,priceLabel:version.label,tokenAmount:amount.toString(),quoteHash,expiresAt:expires.toISOString(),availableTokens:wallet.available_tokens,reservedTokens:wallet.reserved_tokens,affordable:BigInt(wallet.available_tokens)>=amount,test:billingRealm()==="TEST",internalBeta:version.rules.approval==='INTERNAL_BETA'};
}
export async function validateQuote(db:DbClient,workspaceId:string,operation:Operation,raw:Record<string,unknown>,input:JobInput,requestHash:string){
 if(typeof raw.quoteId!=="string"||!isUuid(raw.quoteId)||typeof raw.quoteHash!=="string")throw new AppError(400,"Get a token quote before submitting.");
 const q=(await db.query<Quote>("SELECT * FROM billing_quotes WHERE workspace_id=$1 AND id=$2 FOR SHARE",[workspaceId,raw.quoteId])).rows[0];
 if(!q)throw new AppError(404,"Quote not found.");
 if(q.billing_account_id!==(await workspaceBillingAccount(workspaceId,db)).billing_account_id)throw new AppError(409,'Quote billing account changed. Get a new quote.');
 if(q.operation!==operation||q.quote_hash!==raw.quoteHash||q.request_hash!==requestHash||q.input_hash!==inputHash(input))throw new AppError(409,"The request changed. Get a new token quote.");
 if(q.expires_at.getTime()<=Date.now())throw new AppError(409,"Token quote expired. Get a new quote.");
 return q;
}
export async function reserveJob(db:DbClient,workspaceId:string,jobId:string,q:Quote){
 await db.query("INSERT INTO job_billing(job_id,workspace_id,quote_id,price_version_id,token_amount,billing_account_id) VALUES($1,$2,$3,$4,$5,$6)",[jobId,workspaceId,q.id,q.price_version_id,q.token_amount,q.billing_account_id]);
 const r=await db.query<{id:string}>("INSERT INTO token_ledger_entries(workspace_id,entry_type,available_delta,reserved_delta,job_id,quote_id,idempotency_key,billing_account_id) VALUES($1,'RESERVE',-$2::bigint,$2,$3,$4,$5,$6) RETURNING id",[workspaceId,q.token_amount,jobId,q.id,`job:${jobId}:reserve`,q.billing_account_id]);
 await db.query("UPDATE job_billing SET reserve_ledger_id=$1 WHERE job_id=$2",[r.rows[0].id,jobId]);
 await audit(db,{workspaceId,type:"JOB_TOKENS_RESERVED",targetType:"job",targetId:jobId,metadata:{tokens:q.token_amount,quoteId:q.id}});
}
export async function issue(db:DbClient,code:string,workspaceId:string|null,jobId:string|null=null,paymentId:string|null=null,suffix="",billingAccountId:string|null=null){
 await db.query("INSERT INTO billing_reconciliation_issues(workspace_id,code,job_id,payment_id,issue_key,billing_account_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(issue_key) DO NOTHING",[workspaceId,code,jobId,paymentId,`${code}:${jobId||paymentId||billingAccountId||workspaceId||'unknown'}:${suffix}`,billingAccountId]);
}
export async function jobBilling(workspaceId:string,jobId:string){return (await query<{token_amount:string;status:string;quote_id:string;price_version_id:string}>("SELECT token_amount,status,quote_id,price_version_id FROM job_billing WHERE workspace_id=$1 AND job_id=$2",[workspaceId,jobId])).rows[0]||null;}
// Wallet-first locking is shared by every accounting mutation. JobBilling itself is durable settlement work.
export async function settleJob(workspaceId:string,jobId:string){return transaction(async db=>{
 await lockWallet(db,workspaceId);
 const b=(await db.query<{status:string;token_amount:string}>("SELECT * FROM job_billing WHERE workspace_id=$1 AND job_id=$2 FOR UPDATE",[workspaceId,jobId])).rows[0];if(!b)return false;
 const j=(await db.query<{status:string;result:{artifactIds?:string[]}|null;attempt_count:number}>("SELECT status,result,attempt_count FROM jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",[workspaceId,jobId])).rows[0];
 if(j.status==="SUCCEEDED"&&b.status==="RELEASED"){await issue(db,"LATE_SUCCESS_AFTER_RELEASE",workspaceId,jobId);return false;}
 if(b.status!=="RESERVED")return false;
 let type:"CAPTURE"|"RELEASE";
 if(j.status==="SUCCEEDED"){
  const ids=j.result?.artifactIds;
  const sealed=Array.isArray(ids)&&ids.length>0&&ids.length<=12&&ids.every(id=>typeof id==="string"&&isUuid(id))&&new Set(ids).size===ids.length&&(await db.query("SELECT a.id FROM job_artifacts a JOIN job_attempts t ON t.id=a.attempt_id AND t.job_id=a.job_id AND t.workspace_id=a.workspace_id WHERE a.workspace_id=$1 AND a.job_id=$2 AND a.id=ANY($3::uuid[]) AND a.status='READY' AND a.sha256 IS NOT NULL AND a.byte_size>0 AND t.status='SUCCEEDED' AND t.attempt_number=$4",[workspaceId,jobId,ids,j.attempt_count])).rowCount===ids.length;
  const intent=(await db.query("SELECT job_id FROM content_publications WHERE workspace_id=$1 AND job_id=$2",[workspaceId,jobId])).rowCount;
  if(!sealed||!intent){await issue(db,"SUCCESS_WITHOUT_SEALED_MANIFEST",workspaceId,jobId);return false;}type="CAPTURE";
 }else if(["FAILED","CANCELLED"].includes(j.status)){
  if((await db.query("SELECT id FROM provider_executions WHERE workspace_id=$1 AND job_id=$2 AND state IN('SUBMITTING','SUBMISSION_UNKNOWN','SUBMITTED','RUNNING','OUTPUT_PENDING')",[workspaceId,jobId])).rowCount){await issue(db,"TERMINAL_JOB_WITH_UNCERTAIN_PROVIDER",workspaceId,jobId);return false;}type="RELEASE";
 }else return false;
 const r=await db.query<{id:string}>("INSERT INTO token_ledger_entries(workspace_id,entry_type,available_delta,reserved_delta,job_id,idempotency_key) VALUES($1,$2,$3,-$4::bigint,$5,$6) RETURNING id",[workspaceId,type,type==="RELEASE"?b.token_amount:"0",b.token_amount,jobId,`job:${jobId}:${type.toLowerCase()}`]);
 await db.query(`UPDATE job_billing SET status=$1,${type==="CAPTURE"?"capture":"release"}_ledger_id=$2,settled_at=now() WHERE job_id=$3`,[type==="CAPTURE"?"CAPTURED":"RELEASED",r.rows[0].id,jobId]);
 await audit(db,{workspaceId,type:type==="CAPTURE"?"JOB_TOKENS_CAPTURED":"JOB_TOKENS_RELEASED",targetType:"job",targetId:jobId,metadata:{tokens:b.token_amount}});return true;
 });}
export async function settlementBatch(limit=25){const jobs=(await query<{workspace_id:string;job_id:string}>("SELECT b.workspace_id,b.job_id FROM job_billing b JOIN jobs j ON j.id=b.job_id WHERE (b.status='RESERVED' AND j.status IN('SUCCEEDED','FAILED','CANCELLED')) OR (b.status='RELEASED' AND j.status='SUCCEEDED' AND NOT EXISTS(SELECT 1 FROM billing_reconciliation_issues i WHERE i.job_id=j.id AND i.code='LATE_SUCCESS_AFTER_RELEASE')) ORDER BY b.created_at,b.job_id LIMIT $1",[limit])).rows;let count=0;for(const j of jobs)if(await settleJob(j.workspace_id,j.job_id))count++;return count;}
export async function supportEntry(args:{billingAccountId:string;workspaceId:string;operatorId:string;reason:string;key:string;amount?:string;type:"PROMOTIONAL_GRANT"|"ADMIN_ADJUSTMENT"|"REFUND";jobId?:string}){
 if(!isUuid(args.billingAccountId)||!isUuid(args.workspaceId)||!isUuid(args.operatorId)||args.reason.trim().length<5||args.reason.length>500||! /^[A-Za-z0-9:_-]{8,160}$/.test(args.key))throw new AppError(400,"Account, attribution workspace, operator, reason and stable key are required.");
 return transaction(async db=>{const wallet=await lockWallet(db,args.workspaceId);if(wallet.billing_account_id!==args.billingAccountId)throw new AppError(409,'Workspace does not belong to the specified billing account.');
 const actor=(await db.query<{id:string;email:string}>("SELECT id,email FROM users WHERE id=$1 AND status='ACTIVE'",[args.operatorId])).rows[0];
 if(!actor||!allowlistedOperator(actor)&&!(nonProductionTestAllowed()&&process.env.DATABASE_URL===process.env.TEST_DATABASE_URL))throw new AppError(403,"Allowlisted active operator identity is required.");
 const previous=(await db.query<{id:string;workspace_id:string;entry_type:string;reason:string;operator_id:string;available_delta:string;job_id:string|null}>("SELECT * FROM token_ledger_entries WHERE billing_account_id=$1 AND idempotency_key=$2 AND (idempotency_scope='ACCOUNT' OR workspace_id=$3)",[args.billingAccountId,args.key,args.workspaceId])).rows[0];
 let amount:bigint;if(args.type==="REFUND"){if(!args.jobId||!isUuid(args.jobId))throw new AppError(400,"Job is required.");const b=(await db.query<{status:string;token_amount:string}>("SELECT status,token_amount FROM job_billing WHERE workspace_id=$1 AND job_id=$2 FOR UPDATE",[args.workspaceId,args.jobId])).rows[0];if(!b)throw new AppError(404,"Job billing not found.");amount=BigInt(b.token_amount);if(!previous&&b.status!=="CAPTURED")throw new AppError(409,"Only a captured job can be refunded once.");}else {const negative=args.amount?.startsWith("-");amount=integer(negative?args.amount!.slice(1):args.amount,true)*(negative?-BigInt(1):BigInt(1));if(args.type==="PROMOTIONAL_GRANT"&&amount<BigInt(0))throw new AppError(400,"Grant must be positive.");}
 if(previous){if(previous.workspace_id!==args.workspaceId||previous.entry_type!==args.type||previous.reason!==args.reason||previous.operator_id!==args.operatorId||previous.available_delta!==amount.toString()||previous.job_id!==(args.jobId||null))throw new AppError(409,"Support key was used for different input.");return {id:previous.id,existing:true};}
 const r=await db.query<{id:string}>("INSERT INTO token_ledger_entries(workspace_id,entry_type,available_delta,reserved_delta,job_id,idempotency_key,operator_id,reason) VALUES($1,$2,$3,0,$4,$5,$6,$7) RETURNING id",[args.workspaceId,args.type,amount.toString(),args.jobId||null,args.key,args.operatorId,args.reason]);
 if(args.type==="REFUND")await db.query("UPDATE job_billing SET status='REFUNDED',refund_ledger_id=$1 WHERE job_id=$2",[r.rows[0].id,args.jobId]);
 await audit(db,{workspaceId:args.workspaceId,actorUserId:args.operatorId,type:args.type==="REFUND"?"TOKENS_REFUNDED":args.type==="PROMOTIONAL_GRANT"?"TOKENS_GRANTED":"TOKENS_ADJUSTED",targetType:"ledger",targetId:r.rows[0].id,metadata:{reason:args.reason,tokens:amount.toString(),requestKey:args.key}});return {id:r.rows[0].id,existing:false};});
}
