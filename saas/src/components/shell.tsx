"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "./api";

export type WorkspaceChoice = {id:string;name:string;slug:string;role:string;can_manage_billing?:boolean};
export function Shell({user,workspaces,current,children}:{user:{displayName:string;email:string};workspaces:WorkspaceChoice[];current:WorkspaceChoice;children:React.ReactNode}) {
  const router=useRouter();
  const [switching,setSwitching]=useState(false);
  const [pending,startTransition]=useTransition();
  const [creating,setCreating]=useState(false),[name,setName]=useState(""),[error,setError]=useState("");
  function reloadWorkspace(){startTransition(()=>{router.replace("/");router.refresh();});}
  async function switchTo(id:string) {
    if(id===current.id)return;setSwitching(true);
    setError("");
    try {await api(`/api/workspaces/${id}/select`,"POST");reloadWorkspace();}
    catch(cause) {setError(cause instanceof Error?cause.message:"Workspace could not be switched.");}
    finally {setSwitching(false);}
  }
  async function create(event:FormEvent){event.preventDefault();setSwitching(true);setError("");try{
    const {workspace}=await api<{workspace:{id:string}}>("/api/workspaces","POST",{name});
    await api(`/api/workspaces/${workspace.id}/select`,"POST");setCreating(false);setName("");reloadWorkspace();
  }catch(cause){setError(cause instanceof Error?cause.message:"Workspace could not be created.");}finally{setSwitching(false);}}
  async function signOut() {await api("/api/auth/logout","POST");router.replace("/login");router.refresh();}
  return <div className="app-shell"><aside className="sidebar"><Link className="wordmark sidebar-brand" href="/">Content Workspace <span>Preview</span></Link><div className="workspace-pick"><small>WORKSPACE</small><select aria-label="Switch workspace" value={current.id} disabled={switching||pending} onChange={e=>void switchTo(e.target.value)}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><small>{current.role.toLowerCase()} access</small>{current.can_manage_billing&&<button className="text-button" onClick={()=>setCreating(!creating)} disabled={switching||pending}>Create workspace</button>}{creating&&<form className="workspace-create" onSubmit={create}><label>Workspace name<input required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)} autoFocus /></label><button className="button secondary" disabled={switching||pending}>Create workspace</button></form>}{error&&<p className="notice error" role="alert">{error}</p>}</div><nav aria-label="Main navigation"><Link href="/" className="nav-item">⌂ <span>Home</span></Link><Link href="/products" className="nav-item">◇ <span>Products</span></Link><Link href="/ai-videos" className="nav-item">▣ <span>AI Videos</span></Link><Link href="/clipper" className="nav-item">✂ <span>Clipper</span></Link><Link href="/outreach" className="nav-item">↗ <span>Outreach</span></Link><Link href="/workflows" className="nav-item">⇄ <span>Workflows</span></Link><Link href="/content" className="nav-item">▤ <span>Content Library</span></Link><Link href="/review" className="nav-item">✓ <span>Review Center</span></Link><Link href="/jobs" className="nav-item">◷ <span>Jobs</span></Link><Link href="/billing" className="nav-item">◈ <span>Billing</span></Link><Link href="/settings" className="nav-item">⚙ <span>Settings</span></Link></nav><div className="sidebar-user"><div className="avatar">{user.displayName.slice(0,1).toUpperCase()}</div><div><strong>{user.displayName}</strong><small>{user.email}</small></div></div></aside><div className="main-column"><header className="topbar"><div className="topbar-title">Customer workspace</div><div className="topbar-actions"><span className="status-dot"/> Beta preparation <button className="text-button" onClick={()=>void signOut()}>Sign out</button></div></header><main className="content" key={current.id}>{children}</main></div></div>;
}
