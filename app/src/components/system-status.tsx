"use client";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icon";
import { StatusBadge } from "./ui";
type Service = { label:string; status:string; note:string; tone:"neutral"|"success"|"warning"|"danger"; icon:IconName };
const initial:Service[] = [
  {label:"AI Videos",status:"Checking",note:"Checking generation availability…",tone:"neutral",icon:"video"},
  {label:"Video connection",status:"Checking",note:"Checking video connection…",tone:"neutral",icon:"link"},
  {label:"Clipper",status:"Checking",note:"Checking job monitoring…",tone:"neutral",icon:"scissors"},
  {label:"Outreach",status:"Checking",note:"Checking campaign monitoring…",tone:"neutral",icon:"send"},
];
export function SystemStatus({ compact=false }: { compact?:boolean }) {
  const [services,setServices]=useState(initial);
  useEffect(()=>{
    const controller=new AbortController();
    async function read(path:string):Promise<Record<string,unknown>> { try { const r=await fetch(path,{cache:"no-store",signal:controller.signal});return r.ok?await r.json():{}; } catch {return {};} }
    const refresh=()=>{ void Promise.all([read("/api/ai-video/bridge/status"),read("/api/clipper/overview"),read("/api/outreach/overview"),read("/api/outreach/status")]).then(([video,clipper,outreach,sender])=>{
      if(controller.signal.aborted)return;
      const busy=video.comfy==="busy"||video.creative==="busy";
      const ready=video.readyToGenerate===true;
      const queueEnabled=typeof sender.message==="string"&&sender.message.includes("queueing is enabled");
      setServices([
        {label:"AI Videos",status:ready?"Available":busy?"Busy":video.state==="connected"?"Unavailable":"Offline",note:ready?"Ready for a new video.":busy?"Another generation is in progress.":"Generation is currently unavailable.",tone:ready?"success":busy?"warning":"danger",icon:"video"},
        {label:"Video connection",status:video.state==="connected"?"Connected":"Offline",note:video.state==="connected"?"Video request connection is available.":"Video request connection is unavailable.",tone:video.state==="connected"?"success":"danger",icon:"link"},
        {label:"Clipper",status:clipper.state==="connected"?"Available":"Offline",note:clipper.state==="connected"?"Read-only jobs and scores are available.":"Open Clipper to check its service.",tone:clipper.state==="connected"?"success":"danger",icon:"scissors"},
        {label:"Outreach",status:outreach.state!=="connected"?"Offline":!queueEnabled?"Sending Disabled":sender.sender==="available"?"Available":"Sending Unavailable",note:outreach.state==="connected"?"Campaign monitoring is available.":"Campaign data is unavailable.",tone:outreach.state!=="connected"?"danger":!queueEnabled?"neutral":sender.sender==="available"?"success":"warning",icon:"send"},
      ]);
    }); };
    refresh();const timer=window.setInterval(refresh,30000);return ()=>{controller.abort();window.clearInterval(timer);};
  },[]);
  return <div className={compact?"service-list":"service-grid"} aria-live="polite">{services.filter(s=>!compact||s.label!=="Video connection").map(s=><article className="service-card" key={s.label}><div className="service-title"><Icon name={s.icon} />{s.label}</div><StatusBadge tone={s.tone}>{s.status}</StatusBadge><p>{s.note}</p></article>)}</div>;
}
