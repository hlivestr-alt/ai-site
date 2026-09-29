"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function OnboardingForm({displayName}:{displayName:string}) {
  const router=useRouter();
  const [name,setName]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{const data=await api<{workspace:{id:string}}>("/api/workspaces","POST",{name});await api(`/api/workspaces/${data.workspace.id}/select`,"POST");router.replace("/");router.refresh();}catch(cause){setError(cause instanceof Error?cause.message:"Could not create workspace.");setBusy(false);}}
  return <main className="onboarding"><Link className="wordmark" href="/">Content Workspace <span>Preview</span></Link><section className="onboarding-card"><span className="eyebrow">STEP 01 / 01</span><h1>Welcome, {displayName}.</h1><p>Give your team a workspace. You will be its Owner and can invite teammates once it is ready.</p><form onSubmit={submit}><label>Workspace name<input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={100} placeholder="Your brand or company" required /></label>{error&&<p className="notice error" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy?"Creating…":"Create workspace"} <span>→</span></button></form></section></main>;
}
