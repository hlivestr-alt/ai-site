import { createHash } from "node:crypto";
import type { AiVideoInput, FrozenAsset } from "../job-core";
import { objectStorage } from "../storage";
import { ProviderSafeError, SubmissionUnknownError, type ProviderCapabilities, type ProviderPoll, type VideoProvider } from "./types";

const DEFAULT_BASE="https://ark.ap-southeast.bytepluses.com";
const capabilities:ProviderCapabilities={minDurationSeconds:4,maxDurationSeconds:30,aspectRatios:["9:16","16:9","1:1"],maxReferenceImages:4,maxQuantity:1};
function baseUrl(){
  const url=new URL(process.env.BYTEPLUS_ARK_BASE_URL||DEFAULT_BASE);
  if(url.protocol!=="https:"||url.hostname!=="ark.ap-southeast.bytepluses.com"||url.pathname!=="/"||url.search||url.hash||url.username||url.password)throw new Error("BYTEPLUS_ARK_BASE_URL must be the official AP Southeast API origin");
  return url.origin;
}
function apiKey(){const key=process.env.BYTEPLUS_ARK_API_KEY;if(!key)throw new ProviderSafeError("PROVIDER_UNAVAILABLE","Video generation is not configured.");return key;}
async function readReference(asset:FrozenAsset){
  if(!["image/png","image/jpeg","image/webp"].includes(asset.mimeType)||asset.byteSize>4*1024*1024)throw new ProviderSafeError("INVALID_INPUT","A selected reference image is unsupported.");
  const parts:Buffer[]=[];let size=0;const hash=createHash("sha256");
  for await(const chunk of await objectStorage().stream(asset.storageKey)){size+=chunk.length;if(size>4*1024*1024)throw new ProviderSafeError("INVALID_INPUT","A selected reference image is too large.");hash.update(chunk);parts.push(Buffer.from(chunk));}
  if(size!==asset.byteSize||hash.digest("hex")!==asset.sha256)throw new ProviderSafeError("INVALID_INPUT","A selected Product reference changed or is unavailable.");
  return `data:${asset.mimeType};base64,${Buffer.concat(parts).toString("base64")}`;
}
function outputHostAllowed(url:URL){return url.protocol==="https:"&&/\.(?:bytepluses|volces)\.com$/.test(url.hostname)&&!url.username&&!url.password;}
export class BytePlusVideoProvider implements VideoProvider {
  readonly name="BYTEPLUS" as const;
  capabilities(){return capabilities;}
  validateInput(input:AiVideoInput){
    if(input.durationSeconds<4||input.durationSeconds>30||!capabilities.aspectRatios.includes(input.aspectRatio)||input.quantity!==1||input.referenceAssetVersionIds.length>4)throw new ProviderSafeError("INVALID_INPUT","This Seedance video request is not supported.");
  }
  async submit(input:AiVideoInput,model:string){
    if(model!=="dreamina-seedance-2-5-260628")throw new ProviderSafeError("PROVIDER_UNAVAILABLE","The configured video model is not verified.");
    const refs=input.referenceAssetVersionIds.map(id=>input.product.assets.find(a=>a.assetVersionId===id));
    if(refs.some(x=>!x))throw new ProviderSafeError("INVALID_INPUT","A selected reference is unavailable.");
    const images=[];for(const asset of refs)images.push({type:"image_url",image_url:{url:await readReference(asset!)},role:"reference_image"});
    const content=[{type:"text",text:`${input.customerPrompt}\n\nProduct accuracy guidance: ${input.accuracyInstructions}`},...images];
    let response:Response;
    try{response=await fetch(`${baseUrl()}/api/v3/contents/generations/tasks`,{method:"POST",headers:{Authorization:`Bearer ${apiKey()}`,"Content-Type":"application/json"},body:JSON.stringify({model,content,ratio:input.aspectRatio,duration:input.durationSeconds,resolution:"720p",output_format:"mp4",generate_audio:false,watermark:false,omni_reference_task_type:"reference"}),signal:AbortSignal.timeout(30000)});}
    catch{throw new SubmissionUnknownError();}
    if(response.status===429)throw new ProviderSafeError("PROVIDER_RATE_LIMIT","The video provider is busy. Retrying shortly.",true);
    if(response.status>=500)throw new SubmissionUnknownError();
    if(!response.ok)throw new ProviderSafeError(response.status===400?"PROVIDER_REJECTED":"PROVIDER_UNAVAILABLE","The video provider rejected this request.");
    const body=await response.json().catch(()=>null) as {id?:unknown}|null;
    if(typeof body?.id!=="string"||!body.id)throw new SubmissionUnknownError();
    return {externalTaskId:body.id};
  }
  async findBySubmissionToken(){return null;}
  async poll(externalTaskId:string):Promise<ProviderPoll>{
    if(!/^[A-Za-z0-9_-]{4,160}$/.test(externalTaskId))throw new ProviderSafeError("PROVIDER_REJECTED","Provider task ID is invalid.");
    let response:Response;
    try{response=await fetch(`${baseUrl()}/api/v3/contents/generations/tasks/${encodeURIComponent(externalTaskId)}`,{headers:{Authorization:`Bearer ${apiKey()}`},signal:AbortSignal.timeout(20000)});}
    catch{throw new ProviderSafeError("PROVIDER_UNAVAILABLE","The video provider status is temporarily unavailable.",true);}
    if(!response.ok)throw new ProviderSafeError("PROVIDER_UNAVAILABLE","The video provider status is temporarily unavailable.",true);
    const body=await response.json().catch(()=>null) as Record<string,unknown>|null;
    if(!body||typeof body.status!=="string")throw new ProviderSafeError("PROVIDER_UNAVAILABLE","The video provider status was invalid.",true);
    const status=body.status==="expired"?"failed":body.status;
    if(!["queued","running","succeeded","failed","cancelled"].includes(status))throw new ProviderSafeError("PROVIDER_UNAVAILABLE","The video provider status was unknown.",true);
    const content=body.content as {video_url?:unknown}|undefined,error=body.error as {code?:unknown}|undefined,usage=body.usage as {completion_tokens?:unknown}|undefined;
    return {status:status as ProviderPoll["status"],outputUrl:typeof content?.video_url==="string"?content.video_url:undefined,errorCode:typeof error?.code==="string"?error.code.slice(0,80):undefined,usage:typeof usage?.completion_tokens==="number"?{completionTokens:usage.completion_tokens}:undefined,durationSeconds:typeof body.duration==="number"?body.duration:undefined};
  }
  async cancel(externalTaskId:string){
    if(!/^[A-Za-z0-9_-]{4,160}$/.test(externalTaskId))return false;
    try{const response=await fetch(`${baseUrl()}/api/v3/contents/generations/tasks/${encodeURIComponent(externalTaskId)}`,{method:"DELETE",headers:{Authorization:`Bearer ${apiKey()}`},signal:AbortSignal.timeout(15000)});return response.ok;}catch{return false;}
  }
  async retrieve(poll:ProviderPoll){
    if(!poll.outputUrl)throw new ProviderSafeError("OUTPUT_UNAVAILABLE","The video provider did not return an output.",true);
    let url:URL;try{url=new URL(poll.outputUrl);}catch{throw new ProviderSafeError("OUTPUT_INVALID","The provider output address was invalid.");}
    if(!outputHostAllowed(url))throw new ProviderSafeError("OUTPUT_INVALID","The provider output host was invalid.");
    let response:Response;try{response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(60000)});}catch{throw new ProviderSafeError("OUTPUT_UNAVAILABLE","The video download is temporarily unavailable.",true);}
    if(!response.ok||!response.body)throw new ProviderSafeError("OUTPUT_UNAVAILABLE","The video download is temporarily unavailable.",true);
    const body=response.body;
    const stream=(async function*(){const reader=body.getReader();try{for(;;){const item=await reader.read();if(item.done)break;yield item.value;}}finally{reader.releaseLock();}})();
    return {stream,mimeType:(response.headers.get("content-type")||"").split(";")[0].toLowerCase(),contentLength:Number(response.headers.get("content-length"))||undefined};
  }
  normalizeProgress(poll:ProviderPoll){return poll.status==="queued"?{percent:10,stage:"provider_queued",message:"Queued with video provider"}:poll.status==="running"?{percent:40,stage:"generating",message:"Generating video"}:{percent:80,stage:"finalizing",message:"Preparing video output"};}
  mapError(error:unknown){return error instanceof ProviderSafeError||error instanceof SubmissionUnknownError?error:new ProviderSafeError("INTERNAL_ERROR","Video processing could not continue.");}
}
