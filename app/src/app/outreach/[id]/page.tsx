"use client";

import { displayHistoricalLabel } from "@/lib/display";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { Campaign, OutreachOverview } from "@/lib/integrations/outreach";

const metrics = ["frozen", "queued", "sending", "sent", "restricted", "failed", "deliveryUnknown", "remaining"] as const;
export default function CampaignDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const validId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [message, setMessage] = useState("Loading campaign...");
  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/outreach/overview", { cache: "no-store" });
        const overview = await response.json() as OutreachOverview;
        if (!response.ok || overview.state !== "connected") throw new Error("Outreach is unavailable.");
        const current = overview.campaigns.find(item => item.id === id);
        if (!cancelled) { setCampaign(current ?? null); setMessage(current ? "" : "Campaign is outside the 100 most recent campaigns."); }
      } catch { if (!cancelled) setMessage("Outreach status is temporarily unavailable."); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [id, validId]);
  const progress = campaign?.frozen ? Math.round((campaign.frozen - campaign.remaining) / campaign.frozen * 100) : 0;
  return <>
    <div className="page-head"><div><div className="eyebrow">Outreach · campaign details</div><h1 className="page-title">{displayHistoricalLabel(campaign?.name ?? "Campaign")}</h1><p className="page-description">Live progress from the existing Outreach records, refreshed every 15 seconds.</p></div><span className="status-pill">{campaign?.state.replaceAll("_", " ") ?? "Checking"}</span></div>
    {(!validId || message) && <div className="muted-box" role="status">{validId ? message : "Invalid campaign ID."}</div>}
    {campaign && <section className="card panel"><h2>Sending progress</h2><p className="page-description">Created {new Date(campaign.createdAt).toLocaleString()} · Target {campaign.targetCount} · {progress}% resolved</p><progress className="detail-progress" value={Math.max(0, campaign.frozen - campaign.remaining)} max={campaign.frozen || 1} aria-label="Campaign progress" /><div className="metric-grid">{metrics.map(key => <div className="muted-box" key={key}><strong>{campaign[key]}</strong><span>{key === "deliveryUnknown" ? "Delivery unknown" : key}</span></div>)}</div><p className="field-note">Counts come from the existing Outreach campaign and recipient state. Pause and resume are available in Outreach.</p></section>}
    <p style={{ marginTop: 24 }}><Link className="text-link" href="/outreach">← Back to campaigns</Link></p>
  </>;
}
