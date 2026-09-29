"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

export function ProtectedMedia({workspaceId,productId,assetId,type,alt,variant="thumbnail"}:{workspaceId:string;productId:string;assetId:string;type:"IMAGE"|"VIDEO";alt:string;variant?:"original"|"thumbnail"}) {
  const [url,setUrl]=useState<string|null>(null);
  useEffect(()=>{
    let live=true;
    const selected=type==="VIDEO"?"original":variant;
    void api<{url:string}>(`/api/workspaces/${workspaceId}/products/${productId}/assets/${assetId}/download?variant=${selected}`).then(result=>{if(live)setUrl(result.url);}).catch(()=>{if(live)setUrl(null);});
    return ()=>{live=false;};
  },[workspaceId,productId,assetId,type,variant]);
  if(!url)return <div className="media-placeholder" aria-label={`${alt} preview unavailable`}>{type==="VIDEO"?"Video preview unavailable":"Preview unavailable"}</div>;
  if(type==="VIDEO")return <video controls preload="metadata" src={url} aria-label={alt} className="product-media" />;
  // Signed media URLs are runtime values; Next/Image cannot optimize this private origin.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className="product-media" />;
}
