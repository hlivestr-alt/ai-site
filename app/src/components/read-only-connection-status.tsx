"use client";

import { useEffect, useState } from "react";

export function ReadOnlyConnectionStatus({ title, endpoint, note }: { title: string; endpoint: string; note: string }) {
  const [state, setState] = useState("checking");
  const [message, setMessage] = useState("Checking connection...");
  useEffect(() => { const controller = new AbortController(); fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(r => r.json()).then((data: { state: string; message: string }) => { setState(data.state); setMessage(data.message); }).catch(() => { if (!controller.signal.aborted) { setState("disconnected"); setMessage("Status check failed."); } }); return () => controller.abort(); }, [endpoint]);
  return <section className="card setting-card"><div className="connection-head"><h2>{title}</h2><span className={`connection-badge ${state === "connected" ? "connected" : "unavailable"}`}>{state === "connected" ? "Connected · read-only" : state === "checking" ? "Checking" : "Disconnected"}</span></div><p>{message}</p><p className="connection-note">{note}</p></section>;
}
