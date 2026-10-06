"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "./api";

export function ProductActions({workspaceId,productId,canEdit,status}:{workspaceId:string;productId:string;canEdit:boolean;status:string}) {
  const router=useRouter();const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function archive(){if(!window.confirm("Archive this product? Its versions and references will be retained."))return;setBusy(true);setError("");try{await api(`/api/workspaces/${workspaceId}/products/${productId}`,"DELETE");router.replace("/products");router.refresh();}catch(cause){setError(cause instanceof Error?cause.message:"Archive failed.");setBusy(false);}}
  async function restore(){setBusy(true);setError('');try{await api(`/api/workspaces/${workspaceId}/products/${productId}/restore`,'POST');router.refresh();}catch(cause){setError(cause instanceof Error?cause.message:'Restore failed.');}finally{setBusy(false);}}
  if(!canEdit)return null;
  if(status==='ARCHIVED')return <div className="detail-actions"><button className="button primary" disabled={busy} onClick={()=>void restore()}>Restore product</button>{error&&<span role="alert" className="notice error">{error}</span>}</div>;
  return <div className="detail-actions"><Link className="button primary" href={`/products/${productId}/edit?step=basic`}>Edit product</Link><Link className="button secondary" href={`/products/${productId}/edit?step=assets`}>Manage assets</Link><Link className="button secondary" href={`/products/${productId}/edit?step=rules`}>Manage rules</Link><button className="button secondary" disabled={busy} onClick={()=>void archive()}>Archive</button>{error&&<span role="alert" className="notice error">{error}</span>}</div>;
}

export function AssetVersionHistory({workspaceId,productId,assetId}:{workspaceId:string;productId:string;assetId:string}) {
  const [versions,setVersions]=useState<{id:string;version_number:number;status:string;original_filename:string;sha256:string|null}[]|null>(null);
  const [error,setError]=useState("");
  async function load(){try{const result=await api<{versions:typeof versions}>(`/api/workspaces/${workspaceId}/products/${productId}/assets/${assetId}/versions`);setVersions(result.versions);}catch(cause){setError(cause instanceof Error?cause.message:"History unavailable.");}}
  return <div className="asset-history"><button className="text-button" onClick={()=>void load()}>Version history</button>{error&&<small role="alert">{error}</small>}{versions&&<ul>{versions.map(v=><li key={v.id}>v{v.version_number} · {v.status.toLowerCase()} · {v.original_filename}</li>)}</ul>}</div>;
}
