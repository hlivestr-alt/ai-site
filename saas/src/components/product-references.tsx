"use client";
import { useRef,useState } from 'react';
import { api } from './api';
import { ProtectedMedia } from './protected-media';
import { referenceSlots } from '@/lib/reference-slots';
import type { ProductDetail } from './product-wizard';

type Intent={assetId:string;versionId:string;uploadUrl:string;requiredHeaders:Record<string,string>};
type Phase='idle'|'preparing'|'uploading'|'validating'|'ready'|'failed';

function transfer(file:File,intent:Intent,onProgress:(percent:number)=>void){
  return new Promise<void>((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('PUT',intent.uploadUrl);xhr.timeout=15*60*1000;
    for(const [name,value] of Object.entries(intent.requiredHeaders))xhr.setRequestHeader(name,value);
    xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.min(100,Math.floor(event.loaded/event.total*100)));};
    xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('Upload failed. Retry this reference.'));
    xhr.onerror=xhr.ontimeout=xhr.onabort=()=>reject(new Error('Upload interrupted. Retry this reference.'));
    xhr.send(file);
  });
}

export function ProductReferences({workspaceId,detail,onChange}:{workspaceId:string;detail:ProductDetail;onChange:()=>Promise<void>}){
  return <div className="reference-grid">{referenceSlots.map(slot=><ReferenceCard key={slot.id} workspaceId={workspaceId} detail={detail} slot={slot} onChange={onChange}/>)}</div>;
}

function ReferenceCard({workspaceId,detail,slot,onChange}:{workspaceId:string;detail:ProductDetail;slot:typeof referenceSlots[number];onChange:()=>Promise<void>}){
  const base=`/api/workspaces/${workspaceId}/products/${detail.product.id}`;
  const asset=detail.assets.find(a=>a.slot===slot.id&&a.status==='READY');
  const [file,setFile]=useState<File|null>(null),[phase,setPhase]=useState<Phase>('idle'),[percent,setPercent]=useState(0),[error,setError]=useState('');
  const intent=useRef<Intent|null>(null),input=useRef<HTMLInputElement>(null);
  const busy=['preparing','uploading','validating'].includes(phase);
  const cover=asset&&detail.cover?.asset_id===asset.id;
  async function upload(){
    if(!file)return;setPhase('preparing');setPercent(0);setError('');
    try{
      // Retire a failed/uncertain intent before issuing another. READY media is never changed by abort.
      const latest=intent.current?null:await api<ProductDetail>(base);
      const previous=intent.current||latest?.pendingUploads.find(p=>p.slot===slot.id);
      if(previous){
        const resolved=await api<{status:string}>(`${base}/assets/${previous.assetId}/versions/${previous.versionId}/abort`,'POST');intent.current=null;
        if(resolved.status==='READY'){await onChange();setPhase('ready');setFile(null);if(input.current)input.current.value='';return;}
      }
      const video=file.type==='video/mp4';
      const purpose=slot.id==='REAL_USAGE'?(video?'USAGE_VIDEO':'USAGE_IMAGE'):slot.id==='SIDE'&&asset?.purpose==='RIGHT_SIDE'?'RIGHT_SIDE':slot.purpose;
      let sha256:string|undefined;
      if(!video){const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());sha256=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');}
      const created=await api<{intent:Intent}>(`${base}/assets/upload-intents`,'POST',{purpose,mimeType:file.type,byteSize:file.size,filename:file.name,sha256});
      intent.current=created.intent;setPhase('uploading');
      await transfer(file,created.intent,setPercent);setPhase('validating');
      await api(`${base}/assets/${created.intent.assetId}/versions/${created.intent.versionId}/finalize`,'POST');
      intent.current=null;await onChange();setPhase('ready');setFile(null);if(input.current)input.current.value='';
    }catch(cause){setError(cause instanceof Error?cause.message:'Upload failed. Retry this reference.');setPhase('failed');}
  }
  async function change(action:'cover'|'remove'){
    if(!asset)return;setPhase('preparing');setError('');
    try{if(action==='cover')await api(`${base}/cover`,'POST',{assetId:asset.id});else await api(`${base}/assets/${asset.id}`,'DELETE');await onChange();setPhase('idle');}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not update reference.');setPhase('failed');}
  }
  return <section className="asset-card reference-card" aria-label={`${slot.label} reference`} data-slot={slot.id}>
    <div className="reference-heading"><h3>{slot.label}</h3>{cover&&<span className="pill cover-label">COVER</span>}</div>
    <div className="asset-visual">{asset?<ProtectedMedia workspaceId={workspaceId} productId={detail.product.id} assetId={asset.id} versionId={asset.current_version_id} type={asset.type} alt={`${slot.label} reference`}/>:<span className="media-placeholder">{slot.video?'Image or MP4 video':'Product image'}</span>}</div>
    <div className="asset-card-body">{asset&&<><strong>{asset.original_filename}</strong><small>Version {asset.version_number}</small></>}
      <label className="reference-file">{asset?'Replace reference':'Choose reference'}<input ref={input} type="file" aria-label={`${slot.label} file`} accept={slot.video?'image/jpeg,image/png,image/webp,video/mp4':'image/jpeg,image/png,image/webp'} disabled={busy} onChange={event=>{setFile(event.target.files?.[0]||null);setError('');setPhase('idle');}}/></label>
      <div aria-live="polite" className="reference-status">{phase==='preparing'?'Preparing…':phase==='uploading'?`Uploading… ${percent}%`:phase==='validating'?'Processing / Validating…':phase==='failed'?'Upload failed':phase==='ready'||asset?'Ready':'No reference yet'}</div>
      {phase==='uploading'&&<progress aria-label={`${slot.label} upload progress`} value={percent} max={100}/>}
      {error&&<p role="alert" className="notice error">{error}</p>}
      {file&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void upload()}>{phase==='failed'?'Retry':asset?'Replace':'Upload'}</button>}
      {asset&&<div className="reference-actions">{asset.type==='IMAGE'&&!cover&&<button type="button" className="text-button" disabled={busy} onClick={()=>void change('cover')}>Set as cover</button>}<button type="button" className="text-button danger" disabled={busy} onClick={()=>void change('remove')}>Remove reference</button></div>}
    </div>
  </section>;
}
