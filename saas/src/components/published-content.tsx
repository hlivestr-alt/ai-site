"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {api} from "./api";
export function PublishedContent({workspaceId,jobId}:{workspaceId:string;jobId:string}){
  const identity=`${workspaceId}:${jobId}`,[publication,setPublication]=useState<{identity:string;items:{id:string;title:string}[]}>({identity:"",items:[]}),items=publication.identity===identity?publication.items:[];
  useEffect(()=>{let active=true;const refresh=()=>void api<{content:{id:string;title:string}[]}>(`/api/workspaces/${workspaceId}/jobs/${jobId}/content`).then(r=>{if(active)setPublication({identity,items:r.content});}).catch(()=>{});refresh();const timer=setInterval(refresh,5000);return()=>{active=false;clearInterval(timer);};},[workspaceId,jobId,identity]);
  return <section className="panel"><h2>{items.length?`Published to Content Library · ${items.length} item${items.length===1?"":"s"}`:"Content Library publication pending"}</h2>{items.length?<ul>{items.map(i=><li key={i.id}><Link href={`/content/${i.id}`}>{i.title}</Link></li>)}</ul>:<p>Your results are ready. They will appear in the Library after publication completes.</p>}</section>;
}
