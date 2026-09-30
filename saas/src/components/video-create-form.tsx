"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

type Product={id:string;name:string;brand:string;version_number:number};
type Options={tiers:{name:string;enabled:boolean;mode:string;durations:number[];aspectRatios:string[];maxQuantity:number}[];referenceLimit:number};
export function VideoCreateForm({workspaceId,products,options,canCreate}:{workspaceId:string;products:Product[];options:Options;canCreate:boolean}){
  const router=useRouter(),tier=options.tiers[0],allowed=[4,5,10,15,20,30].filter(x=>tier.durations.includes(x));
  const [productId,setProductId]=useState(products[0]?.id||""),[prompt,setPrompt]=useState(""),[duration,setDuration]=useState(allowed.includes(5)?5:allowed[0]||4),[ratio,setRatio]=useState(tier.aspectRatios[0]||"9:16"),[pending,setPending]=useState(false),[error,setError]=useState("");
  const key=useRef<string|null>(null);
  const changed=()=>{key.current=null;setError("");};
  async function generate(event:React.FormEvent){
    event.preventDefault();if(pending||!canCreate||!tier.enabled)return;
    setPending(true);setError("");key.current??=crypto.randomUUID();
    try{const response=await api<{job:{id:string}}>(`/api/workspaces/${workspaceId}/ai-videos`,"POST",{productId,prompt,tier:"QUALITY",durationSeconds:duration,aspectRatio:ratio,quantity:1,idempotencyKey:key.current});router.push(`/ai-videos/${response.job.id}`);router.refresh();}
    catch(cause){setError(cause instanceof Error?cause.message:"Video request failed.");setPending(false);}
  }
  return <form className="video-form" onSubmit={event=>void generate(event)}><div className="form-grid"><label>Saved Product<select aria-label="Saved Product" value={productId} onChange={e=>{changed();setProductId(e.target.value);}} disabled={!canCreate||!products.length}>{products.map(p=><option key={p.id} value={p.id}>{p.name} · {p.brand} (v{p.version_number})</option>)}</select></label><label>Quality tier<select aria-label="Quality tier" value="QUALITY" disabled><option value="QUALITY">Quality {tier.mode==="SIMULATION"?"· simulation":"· Seedance 2.5"}</option></select></label></div><label>Describe your video<textarea aria-label="Video prompt" rows={5} value={prompt} onChange={e=>{changed();setPrompt(e.target.value);}} placeholder="Describe the scene, camera movement, and how the Product should appear." disabled={!canCreate||!tier.enabled}/></label><div className="form-grid"><label>Duration<select aria-label="Duration" value={duration} onChange={e=>{changed();setDuration(Number(e.target.value));}} disabled={!canCreate||!tier.enabled}>{allowed.map(x=><option key={x} value={x}>{x} seconds</option>)}</select></label><label>Aspect ratio<select aria-label="Aspect ratio" value={ratio} onChange={e=>{changed();setRatio(e.target.value);}} disabled={!canCreate||!tier.enabled}>{tier.aspectRatios.map(x=><option key={x} value={x}>{x}</option>)}</select></label></div><div className="review-card"><span className="eyebrow">REQUEST SUMMARY</span><strong>{products.find(x=>x.id===productId)?.name||"Select a Product"} · Quality</strong><p>{duration} seconds · {ratio} · 1 video · up to {options.referenceLimit} saved Product images</p><p>Accuracy rules and Product references are frozen when you generate.</p>{tier.mode==="SIMULATION"&&<p className="video-simulation">Local simulation: this creates a test video, not an AI generation.</p>}</div>{error&&<p role="alert" className="notice error">{error}</p>}{!tier.enabled&&<p className="notice error">Video generation is unavailable until the provider is configured.</p>}<div className="wizard-actions"><button className="button primary" type="submit" disabled={!canCreate||!tier.enabled||!products.length||prompt.trim().length<20||pending}>{pending?"Submitting…":"Generate video"}</button></div></form>;
}
