import {AppError,isUuid} from "./core";
import {type DbClient} from "./db";
import {type AiVideoInput,type FrozenAsset,type FrozenProduct} from "./job-core";
import {activeVideoPolicy,fakeEnabled,providerForNewJob} from "./video-providers";
import {billingRealm} from "./billing-core";
const rank=["FRONT","BACK","LEFT_SIDE","RIGHT_SIDE","PACKAGING","CAP_PUMP","TEXTURE"];
const scenarios=["SUCCESS","FAILURE","RATE_LIMIT","SUBMISSION_UNKNOWN","DOWNLOAD_FAIL_ONCE","OVERSIZED_OUTPUT","INVALID_MIME","INVALID_CHECKSUM"] as const;
type Scenario=(typeof scenarios)[number];
export function parseAiVideoRequest(raw:Record<string,unknown>,scenario?:Scenario){
  const productId=raw.productId,prompt=raw.prompt,tier=raw.tier,duration=raw.durationSeconds,ratio=raw.aspectRatio,quantity=raw.quantity,key=raw.idempotencyKey,selected=raw.referenceAssetVersionIds;
  if(typeof productId!=="string"||!isUuid(productId))throw new AppError(400,"Select a valid Product.");
  if(typeof prompt!=="string"||prompt.trim().length<20||prompt.length>2000||/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(prompt))throw new AppError(400,"Prompt must be 20–2000 readable characters.");
  if(tier!=="QUALITY")throw new AppError(400,"This quality tier is unavailable.");
  if(typeof duration!=="number"||!Number.isInteger(duration)||duration<4||duration>30)throw new AppError(400,"Choose a supported duration.");
  if(ratio!=="9:16"&&ratio!=="16:9"&&ratio!=="1:1")throw new AppError(400,"Choose a supported aspect ratio.");
  if(quantity!==1)throw new AppError(400,"One video per request is supported in this preview.");
  if(typeof key!=="string"||!/^[A-Za-z0-9:_-]{8,160}$/.test(key))throw new AppError(400,"Invalid idempotency key.");
  if(selected!==undefined&&(!Array.isArray(selected)||selected.length>4||selected.some(x=>typeof x!=="string"||!isUuid(x))||new Set(selected).size!==selected.length))throw new AppError(400,"Invalid reference selection.");
  const ids=(selected||[]) as string[];
  return {productId,prompt:prompt.trim(),tier,durationSeconds:duration,aspectRatio:ratio as "9:16"|"16:9"|"1:1",quantity:1 as const,idempotencyKey:key,referenceAssetVersionIds:ids,scenario};
}
function accuracyInstructions(product:FrozenProduct){
  const r=product.rules,phrases=[
    r.keepLogo&&"Keep the product logo visually faithful.",r.keepPackagingText&&"Keep packaging text and claims faithful; do not invent wording.",
    r.keepProductShape&&"Preserve the product silhouette and proportions.",r.keepCapPump&&"Preserve the cap or pump structure.",
    r.keepProductColorMaterial&&"Preserve the product color and material.",r.keepApplicationMethod&&"Show only the documented application method.",
  ].filter(Boolean) as string[];
  const custom=typeof r.customInstructions==="string"?r.customInstructions.trim().slice(0,700):"";
  if(custom)phrases.push(custom);
  return phrases.join(" ").slice(0,1400)||"Represent the saved Product reference faithfully.";
}
function validImage(asset:FrozenAsset){
  const width=asset.width||0,height=asset.height||0;
  return asset.type==="IMAGE"&&["image/png","image/jpeg","image/webp"].includes(asset.mimeType)&&asset.byteSize>0&&asset.byteSize<=4*1024*1024&&width>=300&&height>=300&&width<=6000&&height<=6000&&width*height>=407696&&width*height<=8295044&&width/height>=0.4&&width/height<=2.5;
}
function selectReferences(product:FrozenProduct,requested:string[],max:number){
  const candidates=product.assets.filter(validImage).sort((a,b)=>rank.indexOf(a.purpose)-rank.indexOf(b.purpose)||a.assetId.localeCompare(b.assetId));
  if(requested.length){const chosen=requested.map(id=>candidates.find(a=>a.assetVersionId===id));if(chosen.some(x=>!x))throw new AppError(409,"A selected Product reference is unavailable or unsupported.");return requested;}
  const chosen=candidates.slice(0,max).map(x=>x.assetVersionId);
  if(!chosen.length)throw new AppError(409,"Add a compatible READY Product image before generating (for example, 640 × 640 px).");
  return chosen;
}
export function customerVideoScenario(raw:Record<string,unknown>):Scenario|undefined{if(raw.testScenario===undefined)return undefined;if(billingRealm()!=="TEST"||!fakeEnabled())throw new AppError(400,"Test controls are unavailable.");return diagnosticVideoScenario(raw.testScenario);}
export async function prepareAiVideoInput(db:DbClient,input:ReturnType<typeof parseAiVideoRequest>,product:FrozenProduct,scenario?:Scenario){
    const policy=await activeVideoPolicy(db);
    if(!policy||!policy.enabled)throw new AppError(503,"Video generation is not available.");
    const provider=providerForNewJob();
    if(input.durationSeconds<policy.min_duration_seconds||input.durationSeconds>policy.max_duration_seconds||!policy.aspect_ratios.includes(input.aspectRatio)||input.quantity>policy.max_quantity)throw new AppError(400,"The selected video settings are not supported.");
    const references=selectReferences(product,input.referenceAssetVersionIds,policy.max_reference_images);
    const frozen:AiVideoInput={schemaVersion:1,kind:"AI_VIDEO",product,customerPrompt:input.prompt,accuracyInstructions:accuracyInstructions(product),tier:"QUALITY",durationSeconds:input.durationSeconds,aspectRatio:input.aspectRatio,quantity:1,referenceAssetVersionIds:references,providerPolicyVersion:policy.policy_version,executionProvider:provider.name,...(scenario?{testScenario:scenario}:{})};
    provider.validateInput(frozen);
    return frozen;
}
export function diagnosticVideoScenario(raw:unknown):Scenario{
  if(typeof raw!=="string"||!scenarios.includes(raw as Scenario))throw new AppError(400,"Invalid diagnostic scenario.");
  return raw as Scenario;
}
