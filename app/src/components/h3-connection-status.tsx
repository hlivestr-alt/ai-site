"use client";

import { useEffect, useState } from "react";
import type { H3ConnectionStatus } from "@/lib/integrations/h3/types";

export function H3ConnectionStatus() {
  const [status, setStatus] = useState<H3ConnectionStatus | null>(null);
  const [checking, setChecking] = useState(true);

  async function readStatus(signal?: AbortSignal): Promise<H3ConnectionStatus> {
    const response = await fetch("/api/ai-video/status", { cache: "no-store", signal });
    if (!response.ok) throw new Error("Status request failed");
    return await response.json() as H3ConnectionStatus;
  }

  useEffect(() => {
    const controller = new AbortController();
    void readStatus(controller.signal).then(value => setStatus(value)).catch(() => { if (!controller.signal.aborted) setStatus(null); }).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);

  async function check() {
    setChecking(true);
    try { setStatus(await readStatus()); }
    catch { setStatus(null); }
    finally { setChecking(false); }
  }

  const label = checking ? "Checking" : status?.state === "connected" ? "Connected" : status?.state === "misconfigured" ? "Misconfigured" : "Unavailable";
  return <section className="card setting-card" aria-label="Local MiniMax H3 status">
    <div className="connection-head"><h2>Local MiniMax H3</h2><span className={`connection-badge ${status?.state ?? "unavailable"}`}>{label}</span></div>
    <p>{checking ? "Checking the local runner..." : status?.message ?? "The platform could not check the local H3 service."}</p>
    <p className="connection-note">Creative Studio status is read-only. AI Site generation uses the separate H3 bridge.</p>
    <button type="button" className="button-outline connection-check" onClick={() => void check()} disabled={checking}>Check connection</button>
  </section>;
}
