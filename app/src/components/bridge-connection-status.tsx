"use client";

import { useEffect, useState } from "react";
import type { BridgeStatus } from "@/lib/integrations/h3-bridge";

export function BridgeConnectionStatus() {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  useEffect(() => { const controller = new AbortController(); fetch("/api/ai-video/bridge/status", { cache: "no-store", signal: controller.signal }).then(r => r.json()).then(setStatus).catch(() => undefined); return () => controller.abort(); }, []);
  return <section className="card setting-card"><div className="connection-head"><h2>H3 one-shot bridge</h2><span className={`connection-badge ${status?.readyToGenerate ? "connected" : "unavailable"}`}>{status?.readyToGenerate ? "Generation ready" : status?.state === "connected" ? "Connected" : status ? "Offline" : "Checking"}</span></div><p>{status?.message ?? "Checking bridge..."}</p><p className="connection-note">ComfyUI: {status?.comfy ?? "checking"} · Creative Studio: {status?.creative ?? "checking"} · Generation {status?.readyToGenerate ? "available" : "disabled"}</p></section>;
}
