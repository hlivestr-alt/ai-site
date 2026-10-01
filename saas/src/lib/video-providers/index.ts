import { query,type DbClient } from "../db";
import { AppError } from "../core";
import { BytePlusVideoProvider } from "./byteplus";
import { FakeVideoProvider } from "./fake";
import type { ProviderName, VideoProvider } from "./types";

export type VideoPolicy={id:string;customer_tier:"QUALITY";provider:"BYTEPLUS";model:string;policy_version:string;enabled:boolean;min_duration_seconds:number;max_duration_seconds:number;aspect_ratios:string[];max_reference_images:number;max_quantity:number};
const byteplus=new BytePlusVideoProvider(),fake=new FakeVideoProvider();
export function fakeEnabled(){return process.env.APP_ENV==="local"&&process.env.VIDEO_PROVIDER==="fake"&&process.env.ENABLE_FAKE_VIDEO_PROVIDER==="1";}
export function videoConfigured(){return fakeEnabled()||((!process.env.VIDEO_PROVIDER||process.env.VIDEO_PROVIDER==="byteplus")&&!!process.env.BYTEPLUS_ARK_API_KEY);}
export function providerForNewJob():VideoProvider{
  if(fakeEnabled())return fake;
  if(videoConfigured())return byteplus;
  throw new AppError(503,"Video generation is not configured yet.");
}
export function providerForExecution(name:ProviderName):VideoProvider{
  if(name==="FAKE"){
    if(!fakeEnabled())throw new AppError(503,"The diagnostic video provider is unavailable.");
    return fake;
  }
  return byteplus;
}
export async function activeVideoPolicy(db:DbClient={query}){
  const rows=await db.query<VideoPolicy>("SELECT * FROM provider_configurations WHERE customer_tier='QUALITY' AND enabled=true ORDER BY created_at DESC LIMIT 1");
  return rows.rows[0]||null;
}
export async function customerVideoOptions(){
  const policy=await activeVideoPolicy();
  const enabled=!!policy&&videoConfigured();
  return {tiers:[{name:"QUALITY",enabled,mode:fakeEnabled()?"SIMULATION":"LIVE",durations:enabled?Array.from({length:policy!.max_duration_seconds-policy!.min_duration_seconds+1},(_,i)=>i+policy!.min_duration_seconds):[],aspectRatios:enabled?policy!.aspect_ratios:[],maxQuantity:enabled?policy!.max_quantity:0}],referenceLimit:enabled?policy!.max_reference_images:0};
}
