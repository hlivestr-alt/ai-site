"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

export function ProtectedMedia({workspaceId,productId,assetId,versionId,type,alt,variant="thumbnail",initial}:{workspaceId:string;productId:string;assetId:string;versionId?:string|null;type:"IMAGE"|"VIDEO";alt:string;variant?:"original"|"thumbnail";initial?:string}) {
  const identity=`${workspaceId}:${productId}:${assetId}:${versionId}:${variant}`;
  const [media,setMedia]=useState<{url:string;identity:string}|null>(null);
  useEffect(()=>{
    let live=true;
    const selected=type==="VIDEO"?"original":variant;
    const path=`/api/workspaces/${workspaceId}/products/${productId}/assets/${assetId}/download`;
    void api<{url:string}>(`${path}?variant=${selected}`).catch(error=>{if(selected==='thumbnail')return api<{url:string}>(`${path}?variant=original`);throw error;}).then(result=>{if(live)setMedia({url:result.url,identity});}).catch(()=>{if(live)setMedia(null);});
    return ()=>{live=false;};
  },[workspaceId,productId,assetId,versionId,type,variant,identity]);
  const url=media?.identity===identity?media.url:null;
  if(!url)return initial?<span aria-label={`${alt} initial`}>{initial}</span>:<div className="media-placeholder" aria-label={`${alt} preview unavailable`}>{type==="VIDEO"?"Video preview unavailable":"Preview unavailable"}</div>;
  if(type==="VIDEO")return <video controls preload="metadata" src={url} aria-label={alt} className="product-media" />;
  // Signed media URLs are runtime values; Next/Image cannot optimize this private origin.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className="product-media" onError={()=>setMedia(null)} />;
}
