"use client";

import { useEffect, useState } from "react";
import type { OutreachSystemStatus } from "@/lib/integrations/outreach/status";

export function OutreachSenderStatus() {
  const [status, setStatus] = useState<OutreachSystemStatus | null>(null);
  useEffect(() => { const controller = new AbortController(); fetch("/api/outreach/status", { cache: "no-store", signal: controller.signal }).then(r => r.json()).then(setStatus).catch(() => undefined); return () => controller.abort(); }, []);
  return <section className="card setting-card"><div className="connection-head"><h2>Outreach native sender</h2><span className={`connection-badge ${status?.sender === "available" ? "connected" : "unavailable"}`}>{status?.sender === "available" ? "Available" : status ? "Unavailable" : "Checking"}</span></div><p>{status?.message ?? "Checking native sender..."}</p><p className="connection-note">Worker: {status?.worker ?? "checking"}</p></section>;
}
