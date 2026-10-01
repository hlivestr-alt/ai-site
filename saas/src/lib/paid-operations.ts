import {audit,AppError} from "./core";
import {type DbClient} from "./db";
import {insertJob,inputHash,type AiVideoInput,type ClipperInput} from "./job-core";
import {lockWallet,validateQuote,reserveJob} from "./billing-core";

export type WorkflowLineage={runId:string;stepId:string};
// Shared atomic admission contract. The caller owns the surrounding transaction.
export async function admitOperation(db:DbClient,args:{workspaceId:string;userId:string;input:AiVideoInput|ClipperInput;requestHash:string;key:string;quote:Record<string,unknown>;workflow?:WorkflowLineage;diagnostic?:boolean}){
  const {workspaceId,input,requestHash,key,workflow}=args;
  const wallet=args.diagnostic?null:await lockWallet(db,workspaceId);
  const prior=(await db.query<{id:string;client_request_hash:string;input_hash:string;billing_mode:string;workflow_run_id:string|null;workflow_step_id:string|null}>("SELECT id,client_request_hash,input_hash,billing_mode,workflow_run_id,workflow_step_id FROM jobs WHERE workspace_id=$1 AND type=$2 AND idempotency_key=$3",[workspaceId,input.kind,key])).rows[0];
  if(prior){
    if(prior.client_request_hash!==requestHash||(prior.billing_mode==="DIAGNOSTIC")!==!!args.diagnostic||prior.workflow_run_id!==(workflow?.runId||null)||prior.workflow_step_id!==(workflow?.stepId||null)||workflow&&prior.input_hash!==inputHash(input))throw new AppError(409,"Idempotency key was already used for different input.");
    return {id:prior.id,existing:true};
  }
  const q=args.diagnostic?null:await validateQuote(db,workspaceId,input.kind,args.quote,input,requestHash);
  if(q&&BigInt(wallet!.available_tokens)<BigInt(q.token_amount))throw new AppError(402,"Insufficient tokens. Buy tokens in Billing.");
  const result=await insertJob(db,{workspaceId,createdBy:args.userId,type:input.kind,capability:input.kind==="AI_VIDEO"?"CLOUD_AI_VIDEO":input.analyzerProvider==="fake"?"CLIPPER_TEST_V1":"CLIPPER_V1",idempotencyKey:key,input,maxAttempts:input.kind==="AI_VIDEO"?2:3,requestHash,billingMode:args.diagnostic?"DIAGNOSTIC":"PAID",workflow});
  if(!result.existing&&q)await reserveJob(db,workspaceId,result.id,q);
  if(!result.existing&&input.kind==="AI_VIDEO")await audit(db,{workspaceId,actorUserId:args.userId,type:"AI_VIDEO_JOB_CREATED",targetType:"job",targetId:result.id});
  return result;
}
