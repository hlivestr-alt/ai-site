import {AppError,isUuid} from './core';
import {canonicalHash} from './billing-core';
import {defaultVariationSettings,variationFonts,variationGrades,variationStyles,type VariationSettings} from './clipper-variation-settings';
export const VARIATION_POLICY='clipper-visual-variation-v1';
export function variationSettings(raw:unknown):VariationSettings{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!Object.hasOwn(defaultVariationSettings,k)))throw new AppError(400,'Invalid variation settings.');
  const s={...defaultVariationSettings,...raw} as VariationSettings;
  if(typeof s.name!=='string'||s.name.length>80||/[\u0000-\u001f\u007f]/.test(s.name))throw new AppError(400,'Use a variation name of up to 80 characters.');
  for(const k of ['subtitleEnabled','highlightEnabled','phraseCaptions','mirror','letterboxEnabled','topHookEnabled'] as const)if(typeof s[k]!=='boolean')throw new AppError(400,'Invalid variation toggle.');
  for(const k of ['textStyle','hookType','subtitlePosition','subtitleSize','subtitleFont','hookFont','colorGrade'] as const)if(typeof s[k]!=='string')throw new AppError(400,'Select supported variation choices.');
  if(!Object.hasOwn(variationStyles,s.textStyle)||!['none','text'].includes(s.hookType)||!['top','center','bottom'].includes(s.subtitlePosition)||!['compact','small','medium','large'].includes(s.subtitleSize)||!Object.hasOwn(variationFonts,s.subtitleFont)||!Object.hasOwn(variationFonts,s.hookFont)||!(variationGrades as readonly string[]).includes(s.colorGrade))throw new AppError(400,'Select supported variation choices.');
  for(const k of ['fontColor','highlightColor','hookColor'] as const)if(typeof s[k]!=='string'||!/^#[0-9a-f]{6}$/i.test(s[k]))throw new AppError(400,'Use a six-digit color.');
  const bounds={subtitleY:[.08,.92],topBar:[0,.4],bottomBar:[0,.4],hookSize:[24,160],hookX:[0,1],hookY:[0,1]} as const;
  for(const [k,[min,max]] of Object.entries(bounds)){const v=s[k as keyof typeof bounds];if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new AppError(400,'Variation positioning is outside the allowed range.');}
  if(!Number.isInteger(s.hookSize)||s.topHookEnabled&&(!s.letterboxEnabled||s.topBar<.05||s.hookType!=='text'))throw new AppError(400,'Enable a top bar of at least 5% and a text hook first.');
  return {...s,name:s.name.trim()};
}
export function variationRequest(raw:Record<string,unknown>){
  if(Object.keys(raw).some(k=>!['sourceContentId','sourceVersionId','settings','idempotencyKey','quoteId','quoteHash','operation'].includes(k)))throw new AppError(400,'Unsupported variation input.');
  if(typeof raw.sourceContentId!=='string'||typeof raw.sourceVersionId!=='string'||!isUuid(raw.sourceContentId)||!isUuid(raw.sourceVersionId))throw new AppError(400,'Select a saved clip version.');
  if(typeof raw.idempotencyKey!=='string'||!/^[A-Za-z0-9:_-]{8,160}$/.test(raw.idempotencyKey))throw new AppError(400,'Invalid idempotency key.');
  return {sourceContentId:raw.sourceContentId as string,sourceVersionId:raw.sourceVersionId as string,settings:variationSettings(raw.settings),idempotencyKey:raw.idempotencyKey};
}
export function variationRequestHash(request:ReturnType<typeof variationRequest>){const {idempotencyKey,...input}=request;void idempotencyKey;return canonicalHash(input);}
