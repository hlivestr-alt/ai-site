"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const metrics = ["GMV", "UNITS_SOLD", "FOLLOWERS", "AVG_VIDEO_VIEWS", "AVG_LIVE_VIEWERS", "ENGAGEMENT_RATE", "TIKTOK_RELEVANCE"];
const filters = [
  ["keyword", "Creator keyword"], ["minFollowers", "Minimum followers"], ["maxFollowers", "Maximum followers"],
  ["minGmv", "Minimum GMV"], ["maxGmv", "Maximum GMV"], ["minUnitsSold", "Minimum units sold"],
  ["minAvgVideoViews", "Minimum average video views"], ["minAvgLiveViewers", "Minimum average live viewers"], ["minEngagementRate", "Minimum engagement rate"],
] as const;
type Stage = "creating" | "selecting" | "freezing" | "queueing" | "sending" | "failed" | "uncertain";
type OperationResponse = { stage: Stage; campaignId?: string; frozen?: number; error?: string };
const stageText: Record<Stage, string> = {
  creating: "Preparing campaign...", selecting: "Selecting creators...", freezing: "Preparing recipients...",
  queueing: "Queueing campaign...", sending: "Sending", failed: "Campaign could not be sent.", uncertain: "Campaign status needs checking.",
};

export default function NewCampaignPage() {
  const router = useRouter();
  const operationKey = useRef<string | null>(null);
  const running = useRef(false);
  const [messageTemplate, setMessageTemplate] = useState("");
  const [templateLoaded, setTemplateLoaded] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [targetCount, setTargetCount] = useState(10);
  const [cooldownDays, setCooldownDays] = useState(30);
  const [rankingMetric, setRankingMetric] = useState("FOLLOWERS");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/outreach/template", { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json();
      if (!response.ok || typeof value.messageTemplate !== "string" || !value.messageTemplate.trim()) throw new Error("Unable to load outreach message template.");
      setMessageTemplate(value.messageTemplate); setTemplateLoaded(true);
    }).catch(() => { if (!controller.signal.aborted) setTemplateError("Unable to load outreach message template."); });
    return () => controller.abort();
  }, []);

  const run = useCallback(async (key: string, input?: unknown, retry = false) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      let first = true;
      for (;;) {
        const response = await fetch("/api/outreach/send-campaign", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, ...(first && input ? { input } : {}), ...(first && retry ? { retry: true } : {}) }),
        });
        first = false;
        const result = await response.json() as OperationResponse;
        if (!response.ok) throw new Error(result.error || "Campaign could not be sent.");
        setStage(result.stage); setCampaignId(result.campaignId ?? null); setFrozen(result.frozen ?? null);
        if (result.stage === "sending") { router.replace(`/outreach/${result.campaignId}`); return; }
        if (result.stage === "failed" || result.stage === "uncertain") { setError(result.error || "Campaign could not be sent."); return; }
        await new Promise(resolve => setTimeout(resolve, result.stage === "selecting" ? 750 : 200));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Campaign could not be sent. Retry the same operation."); }
    finally { running.current = false; setBusy(false); }
  }, [router]);

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("operation");
    if (!key || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(key)) return;
    operationKey.current = key;
    const timeout = setTimeout(() => { void run(key); }, 0);
    return () => clearTimeout(timeout);
  }, [run]);

  function send() {
    if (running.current || (!operationKey.current && (!templateLoaded || !messageTemplate.trim()))) return;
    let key = operationKey.current;
    if (!key) {
      key = crypto.randomUUID(); operationKey.current = key;
      window.history.replaceState(null, "", `/outreach/new?operation=${key}`);
    }
    const chosenFilters: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(filterValues)) if (value.trim()) chosenFilters[name] = name === "keyword" ? value.trim() : Number(value);
    const input = stage === null ? { messageTemplate, targetCount, cooldownDays, rankingMetric, filters: chosenFilters } : undefined;
    void run(key, input, stage === "failed");
  }

  return <>
    <h1 className="page-title">New campaign</h1>
    {error && <div className="muted-box" role="alert" style={{ color: "var(--red)", marginBottom: 18 }}>{error}{campaignId && <> <Link className="text-link" href={`/outreach/${campaignId}`}>View campaign</Link></>}</div>}
    <section className="card panel">
      {!campaignId && <>
      <label className="field-label" htmlFor="target">Target creator count</label>
      <input id="target" className="input" type="number" min="1" max="500" value={targetCount} onChange={e => setTargetCount(Number(e.target.value))} disabled={busy || Boolean(campaignId)} />
      <label className="field-label" htmlFor="message" style={{ marginTop: 20 }}>Message body</label>
      <textarea id="message" className="textarea" value={messageTemplate} onChange={e => setMessageTemplate(e.target.value)} maxLength={2000} disabled={!templateLoaded || busy || Boolean(campaignId)} />
      {templateError && <p className="login-error" role="alert">{templateError}</p>}
      <div className="two-col" style={{ marginTop: 18 }}><div><label className="field-label" htmlFor="cooldown">Contact cooldown (days)</label><input id="cooldown" className="input" type="number" min="0" max="3650" value={cooldownDays} onChange={e => setCooldownDays(Number(e.target.value))} disabled={busy || Boolean(campaignId)} /></div><div><label className="field-label" htmlFor="ranking">Rank creators by</label><select id="ranking" className="select" value={rankingMetric} onChange={e => setRankingMetric(e.target.value)} disabled={busy || Boolean(campaignId)}>{metrics.map(metric => <option key={metric}>{metric}</option>)}</select></div></div>
      <div className="divider" /><h2>Creator filters</h2>
      <div className="filter-grid">{filters.map(([name, label]) => <div key={name}><label className="field-label" htmlFor={name}>{label}</label><input id={name} className="input" type={name === "keyword" ? "text" : "number"} min={name === "keyword" ? undefined : "0"} value={filterValues[name] ?? ""} onChange={e => setFilterValues(values => ({ ...values, [name]: e.target.value }))} disabled={busy || Boolean(campaignId)} /></div>)}</div>
      <div className="divider" />
      </>}
      <button className="button" type="button" disabled={busy || (!operationKey.current && (!templateLoaded || !messageTemplate.trim())) || stage === "uncertain" || stage === "sending"} onClick={send}>{busy ? stageText[stage ?? "creating"] : "Send Campaign"}</button>
      {stage && <p className="field-note" role="status">{stageText[stage]}{frozen !== null ? ` · ${frozen} creators` : ""}</p>}
    </section>
    <p style={{ marginTop: 24 }}><Link className="text-link" href="/outreach">← Back to campaigns</Link></p>
  </>;
}
