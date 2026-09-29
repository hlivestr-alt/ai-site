"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "./api";

export type WorkspaceChoice = {id:string;name:string;slug:string;role:string};
export function Shell({user,workspaces,current,children}:{user:{displayName:string;email:string};workspaces:WorkspaceChoice[];current:WorkspaceChoice;children:React.ReactNode}) {
  const router=useRouter();
  const [switching,setSwitching]=useState(false);
  async function switchTo(id:string) {
    if(id===current.id)return;setSwitching(true);
    try {await api(`/api/workspaces/${id}/select`,"POST");router.replace("/");router.refresh();}
    catch {setSwitching(false);}
  }
  async function signOut() {await api("/api/auth/logout","POST");router.replace("/login");router.refresh();}
  return <div className="app-shell"><aside className="sidebar"><Link className="wordmark sidebar-brand" href="/">Content Workspace <span>Preview</span></Link><div className="workspace-pick"><small>WORKSPACE</small><select aria-label="Switch workspace" value={current.id} disabled={switching} onChange={e=>void switchTo(e.target.value)}>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select><small>{current.role.toLowerCase()} access</small></div><nav aria-label="Main navigation"><Link href="/" className="nav-item">⌂ <span>Home</span></Link><Link href="/products" className="nav-item">◇ <span>Products</span></Link><Link href="/jobs" className="nav-item">◷ <span>Jobs</span></Link><Link href="/settings" className="nav-item">⚙ <span>Settings</span></Link></nav><div className="sidebar-next"><span className="eyebrow">COMING LATER</span><p>Generation, workflows and billing will appear when their services are ready.</p></div><div className="sidebar-user"><div className="avatar">{user.displayName.slice(0,1).toUpperCase()}</div><div><strong>{user.displayName}</strong><small>{user.email}</small></div></div></aside><div className="main-column"><header className="topbar"><div className="topbar-title">Customer workspace</div><div className="topbar-actions"><span className="status-dot"/> Phase 3 preview <button className="text-button" onClick={()=>void signOut()}>Sign out</button></div></header><main className="content">{children}</main></div></div>;
}
