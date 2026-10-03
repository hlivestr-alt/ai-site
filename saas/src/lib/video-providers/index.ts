import { query,type DbClient } from "../db";
import { AppError } from "../core";
import { BytePlusVideoProvider } from "./byteplus";
import { FakeVideoProvider } from "./fake";
import { WaveSpeedVideoProvider } from "./wavespeed";
import { waveSpeedVideoConfigured, waveSpeedVideoModel } from '../wavespeed-config';
import type { ProviderName, VideoProvider } from "./types";
import {nonProductionTestAllowed,featureEnabled} from '../operational-config';

export type VideoPolicy={id:string;customer_tier:"QUALITY";provider:"BYTEPLUS"|"WAVESPEED";model:string;policy_version:string;enabled:boolean;min_duration_seconds:number;max_duration_seconds:number;aspect_ratios:string[];max_reference_images:number;max_quantity:number};
const byteplus=new BytePlusVideoProvider(),fake=new FakeVideoProvider(),wavespeed=new WaveSpeedVideoProvider();
export function fakeEnabled(){return nonProductionTestAllowed()&&process.env.VIDEO_PROVIDER==="fake"&&process.env.ENABLE_FAKE_VIDEO_PROVIDER==="1";}
export function videoConfigured(){return featureEnabled('AI_VIDEO')&&(fakeEnabled()||(process.env.VIDEO_PROVIDER==="wavespeed"?waveSpeedVideoConfigured():(!process.env.VIDEO_PROVIDER||process.env.VIDEO_PROVIDER==="byteplus")&&!!process.env.BYTEPLUS_ARK_API_KEY));}
export function providerForNewJob():VideoProvider{
  if(fakeEnabled())return fake;
  if(videoConfigured())return process.env.VIDEO_PROVIDER==="wavespeed"?wavespeed:byteplus;
  throw new AppError(503,"Video generation is not configured yet.");
}
export function providerForExecution(name:ProviderName):VideoProvider{
  if(name==="FAKE"){
    if(!fakeEnabled())throw new AppError(503,"The diagnostic video provider is unavailable.");
    return fake;
  }
  if(name==="WAVESPEED")return wavespeed;
  if(name==="BYTEPLUS")return byteplus;
  throw new AppError(503,"The video provider is unavailable.");
}
export async function activeVideoPolicy(db:DbClient={query}){
  const provider=process.env.VIDEO_PROVIDER==="wavespeed"?"WAVESPEED":"BYTEPLUS";
  let model:string|null=null;
  if(provider==="WAVESPEED"){try{model=waveSpeedVideoModel();}catch{return null;}}
  const rows=await db.query<VideoPolicy>("SELECT * FROM provider_configurations WHERE customer_tier='QUALITY' AND provider=$1 AND enabled=true AND ($2::text IS NULL OR model=$2) ORDER BY created_at DESC LIMIT 1",[provider,model]);
  return rows.rows[0]||null;
}
export async function customerVideoOptions(){
  const policy=await activeVideoPolicy();
  const enabled=!!policy&&videoConfigured();
  return {tiers:[{name:"QUALITY",enabled,mode:fakeEnabled()?"SIMULATION":"LIVE",durations:enabled?Array.from({length:policy!.max_duration_seconds-policy!.min_duration_seconds+1},(_,i)=>i+policy!.min_duration_seconds):[],aspectRatios:enabled?policy!.aspect_ratios:[],maxQuantity:enabled?policy!.max_quantity:0}],referenceLimit:enabled?policy!.max_reference_images:0};
}
