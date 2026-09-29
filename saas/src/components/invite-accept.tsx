"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

export function InviteAccept({token}:{token:string}) {
  const router=useRouter();
  const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  async function accept(){setBusy(true);setError("");try{await api(`/api/invitations/${encodeURIComponent(token)}/accept`,"POST");router.replace("/");router.refresh();}catch(cause){setError(cause instanceof Error?cause.message:"Could not accept invitation.");setBusy(false);}}
  return <>{error&&<p className="notice error" role="alert">{error}</p>}<button className="button primary" disabled={busy} onClick={()=>void accept()}>{busy?"Joining…":"Join workspace"} <span>→</span></button></>;
}
