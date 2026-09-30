"use client";
import {useEffect,useState} from "react";
import Image from "next/image";
import {api} from "./api";
export function ContentMedia({workspaceId,contentId,versionId,kind="preview",assetVersionId,alt="Private content",image=false,download=false}:{workspaceId:string;contentId:string;versionId:string;kind?:string;assetVersionId?:string;alt?:string;image?:boolean;download?:boolean}){
  const identity=[workspaceId,contentId,versionId,kind,assetVersionId||""].join(":"),[nonce,setNonce]=useState(0);
  const [media,setMedia]=useState({identity:"",url:"",error:""});
  const url=media.identity===identity?media.url:"",error=media.identity===identity?media.error:"";
  useEffect(()=>{let alive=true;const refresh=()=>{const params=new URLSearchParams({kind});if(assetVersionId)params.set("assetVersionId",assetVersionId);void api<{url:string}>(`/api/workspaces/${workspaceId}/content/${contentId}/versions/${versionId}/media?${params}`).then(r=>{if(alive)setMedia({identity,url:r.url,error:""});}).catch(()=>{if(alive)setMedia({identity,url:"",error:kind==="poster"?"Poster unavailable":"Private media unavailable. Try refreshing."});});};refresh();const timer=setInterval(refresh,240000);return()=>{alive=false;clearInterval(timer);};},[workspaceId,contentId,versionId,kind,assetVersionId,identity,nonce]);
  if(error)return <p className="muted">{error} {kind!=="poster"&&<button className="text-button" onClick={()=>setNonce(n=>n+1)}>Refresh media</button>}</p>;
  if(!url)return <div className="content-placeholder">{kind==="poster"?"Private preview":"Preparing private media…"}</div>;
  if(download)return <a className="button primary" href={url} download>Download MP4</a>;
  // Private URLs stay transient in memory and are never written to storage/history.
  return image?<Image unoptimized loading="eager" width={640} height={640} className="content-image" src={url} alt={alt}/>:<video className="video-preview" aria-label={alt} src={url} controls playsInline preload="metadata" onError={()=>setMedia({identity,url:"",error:"Private media unavailable. Try refreshing."})}/>;
}
