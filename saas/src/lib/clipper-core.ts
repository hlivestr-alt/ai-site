import { createHash } from "node:crypto";
import { AppError, isUuid } from "./core";
export const ANALYZER_POLICY="clip-selection-v1";
export const RENDER_POLICY="vertical-h264-v1";
export const SOURCE_PART_BYTES=64*1024*1024;
export function maxClipperSourceBytes(){const n=Number(process.env.MAX_CLIPPER_SOURCE_BYTES||10*1024**3);return Number.isSafeInteger(n)?Math.max(1024,Math.min(100*1024**3,n)):10*1024**3;}
export function clipperRequest(raw:Record<string,unknown>){
  const sourceAssetId=raw.sourceAssetId,productId=raw.productId||undefined,language=raw.language||"auto",goal=raw.goal;
  if(typeof sourceAssetId!=="string"||!isUuid(sourceAssetId)||productId!==undefined&&(typeof productId!=="string"||!isUuid(productId)))throw new AppError(400,"Select a source and optional Product.");
  if(typeof language!=="string"||!["auto","en","id","zh","es","fr","de","ja","ko","pt","ar","hi"].includes(language))throw new AppError(400,"Unsupported language.");
  if(typeof goal!=="string"||!goal.trim()||goal.length>1000)throw new AppError(400,"Enter a goal of 1–1000 characters.");
  const {targetClipCount,minClipSeconds,maxClipSeconds,captions,idempotencyKey}=raw;
  if(typeof targetClipCount!=="number"||!Number.isInteger(targetClipCount)||targetClipCount<1||targetClipCount>10)throw new AppError(400,"Request 1–10 clips.");
  if(typeof minClipSeconds!=="number"||typeof maxClipSeconds!=="number"||!Number.isInteger(minClipSeconds)||!Number.isInteger(maxClipSeconds)||minClipSeconds<10||maxClipSeconds>90||minClipSeconds>maxClipSeconds)throw new AppError(400,"Clip duration must be 10–90 seconds, with minimum no greater than maximum.");
  if(typeof captions!=="boolean"||raw.aspectRatio!==undefined&&raw.aspectRatio!=="9:16")throw new AppError(400,"Choose captions and a vertical ratio.");
  if(typeof idempotencyKey!=="string"||! /^[A-Za-z0-9:_-]{8,160}$/.test(idempotencyKey))throw new AppError(400,"Invalid idempotency key.");
  return {sourceAssetId,productId:productId as string|undefined,language,goal:goal.trim(),targetClipCount,minClipSeconds,maxClipSeconds,captions,aspectRatio:"9:16" as const,idempotencyKey};
}
export function clipperRequestHash(input:ReturnType<typeof clipperRequest>){const {idempotencyKey,...fields}=input;void idempotencyKey;return createHash("sha256").update(JSON.stringify(fields)).digest("hex");}
export type Clip={artifactId:string;start:number;end:number;duration:number;score:number;hook:string;reason:string;tags:string[];width:number;height:number;sha256:string};
export function validatedClips(raw:unknown,settings:{targetClipCount:number;minClipSeconds:number;maxClipSeconds:number},duration:number):Clip[]{
  if(!Array.isArray(raw)||raw.length<1||raw.length>settings.targetClipCount)throw new AppError(422,"Invalid clip count.");
  const ids=new Set<string>();const clips:Clip[]=[];
  for(const c of raw){
    if(!c||typeof c!=="object"||Object.keys(c).some(k=>!["artifactId","start","end","duration","score","hook","reason","tags","width","height","sha256"].includes(k)))throw new AppError(422,"Invalid clip metadata.");
    if(typeof c.artifactId!=="string"||!isUuid(c.artifactId)||ids.has(c.artifactId)||![c.start,c.end,c.duration,c.score].every(x=>typeof x==="number"&&Number.isFinite(x))||c.start<0||c.end<=c.start||c.end>duration+0.05||c.end-c.start<settings.minClipSeconds||c.end-c.start>settings.maxClipSeconds||Math.abs(c.duration-(c.end-c.start))>0.15||c.score<0||c.score>100||typeof c.hook!=="string"||c.hook.length>160||typeof c.reason!=="string"||c.reason.length>500||!Array.isArray(c.tags)||c.tags.length>8||c.tags.some((t:unknown)=>typeof t!=="string"||t.length>40)||c.width!==720||c.height!==1280||typeof c.sha256!=="string"||! /^[a-f0-9]{64}$/.test(c.sha256))throw new AppError(422,"Invalid clip metadata.");
    for(const prev of clips){const overlap=Math.max(0,Math.min(c.end,prev.end)-Math.max(c.start,prev.start));if(overlap/Math.min(c.duration,prev.duration)>0.5)throw new AppError(422,"Duplicate clip spans.");}
    ids.add(c.artifactId);clips.push(c as Clip);
  }return clips;
}
