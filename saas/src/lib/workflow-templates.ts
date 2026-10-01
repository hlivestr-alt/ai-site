import {AppError,isUuid} from "./core";
import {integer,canonicalHash} from "./billing-core";
import {clipperRequest} from "./clipper-core";
import {parseAiVideoRequest} from "./video-operation";
import type {AiVideoInput,ClipperInput} from "./job-core";

export const TEMPLATE_KEYS=["PRODUCT_AI_VIDEO_REVIEW_V1","SOURCE_CLIPPER_REVIEW_V1"] as const;
export type TemplateKey=typeof TEMPLATE_KEYS[number];
export type ReviewPolicy="ALL_REVIEWED_AT_LEAST_ONE_APPROVED"|"ALL_APPROVED";
export type FailurePolicy="CONTINUE_PARTIAL"|"FAIL_FAST";
type Common={maxTokens:string;reviewPolicy:ReviewPolicy;failurePolicy:FailurePolicy};
export type VideoConfiguration=Common&{kind:"PRODUCT_AI_VIDEO_REVIEW_V1";productId:string;scripts:string[];videosPerScript:number;tier:"QUALITY";durationSeconds:number;aspectRatio:"9:16"|"16:9"|"1:1";referenceAssetVersionIds:string[]};
export type ClipConfiguration=Common&{kind:"SOURCE_CLIPPER_REVIEW_V1";sourceAssetId:string;productId?:string;language:string;goal:string;targetClipCount:number;minClipSeconds:number;maxClipSeconds:number;captions:boolean;aspectRatio:"9:16"};
export type WorkflowConfiguration=VideoConfiguration|ClipConfiguration;
export type PreparedInput=AiVideoInput|ClipperInput;
export type WorkflowSnapshot={schemaVersion:1;definitionName:string;definitionVersionId:string;templateKey:TemplateKey;templateVersion:1;configuration:WorkflowConfiguration;prepared:PreparedInput[];initialMaxTokens:string};
export type StepOutputReference={producerStepId:string;outputKind:"CONTENT_VERSION"|"SOURCE_ASSET"|"JOB_ARTIFACT";objectId:string;versionId:string|null};
export type IntendedChild={childKey:string;inputIndex:number;requestHash:string};
export type PlannedStep={key:string;type:"INPUT"|"SCRIPT_INPUT"|"AI_VIDEO"|"CLIPPER"|"REVIEW_GATE"|"COMPLETE";parentKey?:string;state:"SUCCEEDED"|"READY"|"PENDING";input:Record<string,unknown>};
export type ReviewOutcome={contentId:string;versionId:string;decision:"APPROVED"|"REJECTED"|"PENDING"|"UNAVAILABLE"};
export function workflowBudgetLimit(){
  const raw=process.env.WORKFLOW_MAX_TOKENS||(['local','test'].includes(process.env.APP_ENV||'')?"100000":"");
  if(!raw)throw new AppError(503,"Workflow budget limit must be configured.");
  try{return integer(raw,true);}catch{throw new AppError(503,"Workflow budget limit configuration is invalid.");}
}
export function workflowBudget(value:unknown){const n=integer(value,true);if(n>workflowBudgetLimit())throw new AppError(400,"Workflow budget exceeds the configured maximum.");return n.toString();}
function common(raw:Record<string,unknown>,failure:FailurePolicy):Common{
  const reviewPolicy=raw.reviewPolicy||"ALL_REVIEWED_AT_LEAST_ONE_APPROVED",failurePolicy=raw.failurePolicy||failure;
  if(!["ALL_REVIEWED_AT_LEAST_ONE_APPROVED","ALL_APPROVED"].includes(String(reviewPolicy))||!["FAIL_FAST","CONTINUE_PARTIAL"].includes(String(failurePolicy)))throw new AppError(400,"Choose a supported review and failure policy.");
  return {maxTokens:workflowBudget(raw.maxTokens),reviewPolicy:reviewPolicy as ReviewPolicy,failurePolicy:failurePolicy as FailurePolicy};
}
function object(value:unknown){if(!value||typeof value!=="object"||Array.isArray(value))throw new AppError(400,"Workflow configuration is required.");return value as Record<string,unknown>;}
function fields(raw:Record<string,unknown>,allowed:string[],key:TemplateKey){if(Object.keys(raw).some(k=>!allowed.includes(k))||raw.kind!==undefined&&raw.kind!==key)throw new AppError(400,"Unsupported workflow configuration.");}
export function runRequest(raw:Record<string,unknown>){
  if(Object.keys(raw).some(k=>!["idempotencyKey","definitionVersionId","maxTokens"].includes(k))||typeof raw.idempotencyKey!=="string"||!/^[A-Za-z0-9:_-]{8,160}$/.test(raw.idempotencyKey)||raw.definitionVersionId!==undefined&&(typeof raw.definitionVersionId!=="string"||!isUuid(raw.definitionVersionId)))throw new AppError(400,"Invalid workflow start request.");
  return {key:raw.idempotencyKey,versionId:raw.definitionVersionId as string|undefined,maxTokens:raw.maxTokens===undefined?undefined:workflowBudget(raw.maxTokens)};
}
function children(snapshot:WorkflowSnapshot):IntendedChild[]{
  const c=snapshot.configuration;
  const out=c.kind==="SOURCE_CLIPPER_REVIEW_V1"?[{childKey:"clipper:01",inputIndex:0,requestHash:canonicalHash(snapshot.prepared[0])}]:c.scripts.flatMap((_,s)=>Array.from({length:c.videosPerScript},(_,v)=>({childKey:`video:${String(s+1).padStart(2,"0")}:${String(v+1).padStart(2,"0")}`,inputIndex:s,requestHash:canonicalHash(snapshot.prepared[s])})));
  if(out.length<1||out.length>20)throw new AppError(400,"A workflow may contain at most 20 paid children.");
  return out;
}
function plan(snapshot:WorkflowSnapshot):PlannedStep[]{
  const c=snapshot.configuration,steps:PlannedStep[]=[{key:"input",type:"INPUT",state:"SUCCEEDED",input:c.kind==="PRODUCT_AI_VIDEO_REVIEW_V1"?{productId:c.productId}:{sourceAssetId:c.sourceAssetId,productId:c.productId||null}}];
  if(c.kind==="PRODUCT_AI_VIDEO_REVIEW_V1")c.scripts.forEach((prompt,s)=>steps.push({key:`script:${String(s+1).padStart(2,"0")}`,type:"SCRIPT_INPUT",parentKey:"input",state:"SUCCEEDED",input:{prompt}}));
  for(const child of children(snapshot)){
    steps.push({key:child.childKey,type:c.kind==="PRODUCT_AI_VIDEO_REVIEW_V1"?"AI_VIDEO":"CLIPPER",parentKey:c.kind==="PRODUCT_AI_VIDEO_REVIEW_V1"?`script:${String(child.inputIndex+1).padStart(2,"0")}`:"input",state:"READY",input:{inputIndex:child.inputIndex,childKey:child.childKey}});
    steps.push({key:`review:${child.childKey}`,type:"REVIEW_GATE",parentKey:child.childKey,state:"PENDING",input:{policy:c.reviewPolicy}});
  }
  steps.push({key:"complete",type:"COMPLETE",state:"PENDING",input:{policy:c.reviewPolicy}});return steps;
}
function reconcile(snapshot:WorkflowSnapshot,outcomes:ReviewOutcome[]){
  if(outcomes.some(o=>o.decision==="UNAVAILABLE"))return {state:"FAILED" as const,code:"CONTENT_VERSION_UNAVAILABLE"};
  if(!outcomes.length)return {state:"FAILED" as const,code:"NO_USABLE_CONTENT"};
  if(outcomes.some(o=>o.decision==="PENDING"))return {state:"WAITING_FOR_REVIEW" as const,code:null};
  const approved=outcomes.filter(o=>o.decision==="APPROVED").length;
  if(!approved)return {state:"FAILED" as const,code:"NO_APPROVED_CONTENT"};
  if(snapshot.configuration.reviewPolicy==="ALL_APPROVED"&&approved!==outcomes.length)return {state:"FAILED" as const,code:"REVIEW_POLICY_NOT_SATISFIED"};
  return {state:"SUCCEEDED" as const,code:null};
}
export type WorkflowTemplate={key:TemplateKey;version:1;validateDefinition(value:unknown):WorkflowConfiguration;validateRunInput:typeof runRequest;planSteps:typeof plan;intendedChildren:typeof children;reconcile:typeof reconcile};
const registry:Record<TemplateKey,WorkflowTemplate>={
  PRODUCT_AI_VIDEO_REVIEW_V1:{key:"PRODUCT_AI_VIDEO_REVIEW_V1",version:1,validateRunInput:runRequest,planSteps:plan,intendedChildren:children,reconcile,validateDefinition(value){
    const raw=object(value);fields(raw,["kind","productId","scripts","videosPerScript","tier","durationSeconds","aspectRatio","referenceAssetVersionIds","maxTokens","reviewPolicy","failurePolicy"],this.key);
    if(!Array.isArray(raw.scripts)||raw.scripts.length<1||raw.scripts.length>5||typeof raw.videosPerScript!=="number"||!Number.isInteger(raw.videosPerScript)||raw.videosPerScript<1||raw.videosPerScript>3)throw new AppError(400,"Use 1–5 script variants and 1–3 videos per script.");
    const requests=raw.scripts.map(prompt=>parseAiVideoRequest({...raw,prompt,quantity:1,idempotencyKey:"workflow-validation",tier:raw.tier||"QUALITY"})),first=requests[0];
    return {...common(raw,"CONTINUE_PARTIAL"),kind:"PRODUCT_AI_VIDEO_REVIEW_V1",productId:first.productId,scripts:requests.map(r=>r.prompt),videosPerScript:raw.videosPerScript,tier:"QUALITY",durationSeconds:first.durationSeconds,aspectRatio:first.aspectRatio,referenceAssetVersionIds:first.referenceAssetVersionIds};
  }},
  SOURCE_CLIPPER_REVIEW_V1:{key:"SOURCE_CLIPPER_REVIEW_V1",version:1,validateRunInput:runRequest,planSteps:plan,intendedChildren:children,reconcile,validateDefinition(value){
    const raw=object(value);fields(raw,["kind","sourceAssetId","productId","language","goal","targetClipCount","minClipSeconds","maxClipSeconds","captions","aspectRatio","maxTokens","reviewPolicy","failurePolicy"],this.key);
    const c=common(raw,"FAIL_FAST");if(c.failurePolicy!=="FAIL_FAST")throw new AppError(400,"Clipper workflows use the fail-fast policy.");
    const request=clipperRequest({...raw,idempotencyKey:"workflow-validation"});const {idempotencyKey,...settings}=request;void idempotencyKey;return {...c,...settings,kind:"SOURCE_CLIPPER_REVIEW_V1"};
  }}
};
export function workflowTemplate(key:unknown){if(typeof key!=="string"||!TEMPLATE_KEYS.includes(key as TemplateKey))throw new AppError(400,"Choose a supported workflow template.");return registry[key as TemplateKey];}
