"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function JobRefresh({active}:{active:boolean}){
  const router=useRouter();
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>router.refresh(),5000);return ()=>clearInterval(timer);},[active,router]);
  return <button className="button secondary" onClick={()=>router.refresh()}>Refresh status</button>;
}
export function JobCancel({workspaceId,jobId}:{workspaceId:string;jobId:string}){
  const router=useRouter();const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function cancel(){setBusy(true);setError("");try{await api(`/api/workspaces/${workspaceId}/jobs/${jobId}/cancel`,"POST");router.refresh();}catch(cause){setError(cause instanceof Error?cause.message:"Cancellation failed.");}finally{setBusy(false);}}
  return <><button className="button secondary" disabled={busy} onClick={()=>void cancel()}>Cancel job</button>{error&&<span role="alert" className="notice error">{error}</span>}</>;
}
