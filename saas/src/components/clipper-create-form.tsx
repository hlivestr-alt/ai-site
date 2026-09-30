"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {api} from "./api";
type Source={id:string;filename:string;status:string;byteSize:number};
type Intent={source:Source;mode:string;partSize:number;partCount:number;parts:{partNumber:number;byteSize:number}[];uploadUrl?:string;requiredHeaders:Record<string,string>};
export function ClipperCreateForm({workspaceId,initialSources,products,canCreate,maxBytes,simulation}:{workspaceId:string;initialSources:Source[];products:{id:string;name:string}[];canCreate:boolean;maxBytes:number;simulation:boolean}){
  const router=useRouter();const [sources,setSources]=useState(initialSources),[sourceId,setSourceId]=useState(""),[productId,setProductId]=useState(""),[language,setLanguage]=useState("auto"),[goal,setGoal]=useState("Find clear, useful, self-contained moments."),[count,setCount]=useState(5),[min,setMin]=useState(15),[max,setMax]=useState(45),[captions,setCaptions]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  const [key,setKey]=useState(()=>crypto.randomUUID());
  async function upload(file:File){
    if(file.size>maxBytes){setError("Source exceeds the configured limit.");return;}
    setBusy(true);setError("");setMessage("Preparing private source upload…");
    const sample=new Uint8Array(await new Blob([file.slice(0,65536),file.slice(-65536)]).arrayBuffer()),digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",sample))).map(v=>v.toString(16).padStart(2,"0")).join("");
    const resumeKey=`clipper-upload:${workspaceId}:${file.name}:${file.size}:${file.lastModified}:${digest}`;
    try{
      let intent:Intent;const previous=localStorage.getItem(resumeKey);
      if(previous){try{intent=await api<Intent>(`/api/workspaces/${workspaceId}/sources/${previous}/upload`);}catch{localStorage.removeItem(resumeKey);intent=await api<Intent>(`/api/workspaces/${workspaceId}/sources`,"POST",{filename:file.name,mimeType:"video/mp4",byteSize:file.size});}}
      else intent=await api<Intent>(`/api/workspaces/${workspaceId}/sources`,"POST",{filename:file.name,mimeType:"video/mp4",byteSize:file.size});
      localStorage.setItem(resumeKey,intent.source.id);
      if(intent.mode==="simple"){
        const response=await fetch(intent.uploadUrl!,{method:"PUT",headers:intent.requiredHeaders,body:file,credentials:"omit"});if(!response.ok)throw new Error("Upload failed. Select the same file to retry.");
      }else{
        const done=new Map(intent.parts.map(p=>[p.partNumber,p.byteSize]));
        for(let part=1;part<=intent.partCount;part++){
          const data=file.slice((part-1)*intent.partSize,part*intent.partSize);
          if(done.get(part)===data.size)continue;
          let success=false;
          for(let attempt=0;attempt<3;attempt++){setMessage(`Uploading part ${part} of ${intent.partCount}${attempt?" · retrying":""}`);const access=await api<{url:string}>(`/api/workspaces/${workspaceId}/sources/${intent.source.id}/parts`,"POST",{partNumber:part});try{success=(await fetch(access.url,{method:"PUT",body:data,credentials:"omit"})).ok;}catch{success=false;}if(success)break;}
          if(!success)throw new Error(`Part ${part} failed. Select the same file to resume; completed parts are saved.`);
        }
      }
      setMessage("Finalizing private source…");const source=await api<Source>(`/api/workspaces/${workspaceId}/sources/${intent.source.id}/finalize`,"POST");if(source.status!=="UPLOADED"&&source.status!=="VERIFIED")throw new Error("Source is not a valid MP4.");
      localStorage.removeItem(resumeKey);setSources(rows=>[source,...rows.filter(r=>r.id!==source.id)]);setSourceId(source.id);setMessage("Source uploaded. It will be verified by the worker.");setKey(crypto.randomUUID());router.refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:"Upload failed.");}finally{setBusy(false);}
  }
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{const r=await api<{job:{id:string}}>(`/api/workspaces/${workspaceId}/clipper`,"POST",{sourceAssetId:sourceId,productId:productId||undefined,language,goal,targetClipCount:count,minClipSeconds:min,maxClipSeconds:max,captions,aspectRatio:"9:16",idempotencyKey:key});router.push(`/clipper/${r.job.id}`);}catch(cause){setError(cause instanceof Error?cause.message:"Could not start clipping.");setBusy(false);}}
  function changed(){setKey(crypto.randomUUID());}
  return <>{simulation&&<p className="notice">Local simulation: moment analysis uses a deterministic fixture provider. Transcription and rendering run locally.</p>}{!canCreate&&<p className="notice">Viewer access: you can view source history and completed clips.</p>}<form onSubmit={submit} className="video-form"><label>Upload source video<input aria-label="Upload source video" type="file" accept="video/mp4,.mp4" disabled={busy||!canCreate} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value="";}}/></label><p className="muted">MP4 · up to {(maxBytes/1024**3).toFixed(1)} GiB. Select the same file again to resume an interrupted multipart upload.</p><label>Source video<select aria-label="Source video" value={sourceId} required disabled={busy||!canCreate} onChange={e=>{setSourceId(e.target.value);changed();}}><option value="">Choose an uploaded source</option>{sources.filter(s=>["UPLOADED","VERIFIED"].includes(s.status)).map(s=><option key={s.id} value={s.id}>{s.filename}</option>)}</select></label><label>Product — optional<select aria-label="Product — optional" value={productId} disabled={busy||!canCreate} onChange={e=>{setProductId(e.target.value);changed();}}><option value="">Generic clipping</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Language<select aria-label="Language" value={language} disabled={busy||!canCreate} onChange={e=>{setLanguage(e.target.value);changed();}}>{["auto","en","id","zh","es","fr","de","ja","ko","pt","ar","hi"].map(l=><option key={l} value={l}>{l==="auto"?"Auto":l.toUpperCase()}</option>)}</select></label><label>Clipping goal<textarea value={goal} maxLength={1000} required disabled={busy||!canCreate} onChange={e=>{setGoal(e.target.value);changed();}}/></label><div className="clipper-settings"><label>Number of clips<input type="number" min={1} max={10} value={count} disabled={busy||!canCreate} onChange={e=>{setCount(Number(e.target.value));changed();}}/></label><label>Minimum duration<input type="number" min={10} max={90} value={min} disabled={busy||!canCreate} onChange={e=>{setMin(Number(e.target.value));changed();}}/></label><label>Maximum duration<input type="number" min={10} max={90} value={max} disabled={busy||!canCreate} onChange={e=>{setMax(Number(e.target.value));changed();}}/></label></div><label className="checkbox"><input type="checkbox" checked={captions} disabled={busy||!canCreate} onChange={e=>{setCaptions(e.target.checked);changed();}}/>Captions</label><p className="muted">Vertical 9:16 output. Your job continues after you close this page.</p>{message&&<p role="status">{message}</p>}{error&&<p role="alert" className="notice error">{error}</p>}<button className="button primary" disabled={busy||!canCreate||!sourceId}>{busy?"Working…":"Start clipping"}</button></form></>;
}
