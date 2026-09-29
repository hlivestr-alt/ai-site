"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/icon";
import { PageHeader, StatusBadge, EmptyState } from "@/components/ui";
import type { BridgeStatus } from "@/lib/integrations/h3-bridge";
import type { VideoJob } from "@/lib/integrations/h3-bridge/jobs";

const activeStates = new Set<VideoJob["state"]>(["CREATED", "VALIDATED", "WAITING_FOR_GPU", "SUBMITTING", "SUBMISSION_UNKNOWN", "RUNNING"]);
function statusText(job: VideoJob) {
  if (job.state === "WAITING_FOR_GPU") return "Waiting for AI Video";
  if (job.state === "SUBMITTING" || job.state === "SUBMISSION_UNKNOWN") return "Starting generation";
  if (job.state === "RUNNING") return "Generating video";
  if (job.state === "COMPLETED") return "Video completed";
  if (job.state === "FAILED") return "Generation failed";
  return "Preparing video";
}

export default function AIVideosPage() {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(8);
  const [resolution, setResolution] = useState("576x1024");
  const [references, setReferences] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [job, setJob] = useState<VideoJob | null>(null);
  const [history, setHistory] = useState<VideoJob[]>([]);
  const [historyTab, setHistoryTab] = useState("All");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [statusFailed, setStatusFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const key = useRef<string | null>(null);
  const submitLock = useRef(false);

  useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews]);
  function selectReferences(files: File[]) {
    if (files.length < 1 || files.length > 2) { setError("Choose one or two reference images."); return; }
    const invalid = files.find(file => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024);
    if (invalid) { setError("Each reference must be a PNG, JPEG, or WebP image up to 10 MB."); return; }
    setError(""); setReferences(files); setPreviews(files.map(file => URL.createObjectURL(file))); key.current = null;
  }
  function removeReference(index: number) {
    const next = references.filter((_, i) => i !== index);
    setReferences(next); setPreviews(next.map(file => URL.createObjectURL(file))); key.current = null;
  }
  useEffect(() => {
    const controller = new AbortController();
    const refreshStatus = () => { void fetch("/api/ai-video/bridge/status", { cache: "no-store", signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(value => { setBridge(value); setStatusFailed(false); }).catch(() => { if (!controller.signal.aborted) setStatusFailed(true); }); };
    refreshStatus(); const statusTimer = window.setInterval(refreshStatus, 15000);
    void fetch("/api/ai-video/jobs", { cache: "no-store", signal: controller.signal }).then(r => { if (!r.ok) throw new Error(); return r.json(); }).then((result: { jobs?: VideoJob[] }) => setHistory(result.jobs ?? [])).catch(() => { if (!controller.signal.aborted) setHistoryFailed(true); }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => { controller.abort(); window.clearInterval(statusTimer); };
  }, []);
  useEffect(() => {
    if (!job || !activeStates.has(job.state)) return;
    const timer = window.setInterval(() => { void fetch(`/api/ai-video/jobs/${job.id}`, { cache: "no-store" }).then(r => r.json()).then((next: VideoJob) => {
      if (!next.id) return;
      setJob(next); setHistory(items => [next, ...items.filter(item => item.id !== next.id)]);
    }).catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, [job]);

  async function generate() {
    if (submitLock.current || !bridge?.readyToGenerate || references.length < 1 || references.length > 2) return;
    submitLock.current = true; setSubmitting(true); setError("");
    if (!key.current) key.current = crypto.randomUUID();
    const form = new FormData();
    form.set("prompt", prompt); form.set("duration_seconds", String(duration)); form.set("resolution", resolution); form.set("aspect_ratio", "9:16"); form.set("idempotency_key", key.current);
    for (const file of references) form.append("reference_images", file);
    try {
      const response = await fetch("/api/ai-video/jobs", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Video request failed");
      const created = result as VideoJob; setJob(created); setHistory(items => [created, ...items.filter(item => item.id !== created.id)]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Video request failed"); }
    finally { submitLock.current = false; setSubmitting(false); }
  }
  async function tryWhenIdle() {
    if (!job || submitLock.current) return;
    submitLock.current = true; setSubmitting(true); setError("");
    try {
      const response = await fetch(`/api/ai-video/jobs/${job.id}`, { method: "POST" }); const result = await response.json();
      if (!response.ok) throw new Error(result.error || "AI Video is still busy");
      setJob(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI Video is still busy"); }
    finally { submitLock.current = false; setSubmitting(false); }
  }
  function another() { setJob(null); key.current = null; setPrompt(""); setReferences([]); setPreviews([]); setError(""); }
  const canGenerate = Boolean(bridge?.readyToGenerate && bridge.capabilities?.durations.includes(duration) && bridge.capabilities.resolutions.includes(resolution) && !submitting && !job && prompt.trim().length >= 10 && references.length >= 1 && references.length <= 2 && references.every(file => file.size <= 10 * 1024 * 1024));

  const busy = bridge?.comfy === "busy" || bridge?.creative === "busy";
  const serviceLabel = submitting ? "Generating" : bridge?.readyToGenerate ? "Ready" : busy ? "Busy" : !bridge && !statusFailed ? "Checking" : bridge?.state === "connected" ? "Unavailable" : "Offline";
  const filtered = history.filter(item => historyTab === "All" || historyTab === "Completed" && item.state === "COMPLETED" || historyTab === "Failed" && item.state === "FAILED" || historyTab === "Generating" && activeStates.has(item.state));
  return <>
    <PageHeader title="AI Videos" icon="video" description="" />
    <div className="generation-workspace"><section className="card panel generation-primary"><div className="section-top"><h2>Create Video</h2><StatusBadge tone={bridge?.readyToGenerate?"success":busy?"warning":serviceLabel==="Checking"?"neutral":"danger"}>{serviceLabel}</StatusBadge></div>
      <label className="field-label" htmlFor="prompt">Prompt</label><textarea className="textarea" id="prompt" maxLength={4000} value={prompt} onChange={event => { setPrompt(event.target.value); key.current = null; }} disabled={Boolean(job)} placeholder="Describe the scene, subject, lighting, and camera movement…" /><p className="field-note" style={{textAlign:"right"}}>{prompt.length.toLocaleString()} / 4,000</p>
      <div className="divider" /><div className="generation-reference-row"><div><label className="field-label" htmlFor="references"><Icon name="image" size={17} />Reference Images (1–2)</label>
      <div className="reference-upload-row"><div className={`upload ${dragging ? "dragging" : ""}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!job) selectReferences(Array.from(event.dataTransfer.files)); }}><div><Icon name="plus" size={24} /><strong>Upload Image</strong><span>PNG, JPEG, or WebP · up to 10 MB each</span><div><input id="references" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={Boolean(job)} onChange={event => { selectReferences(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></div></div></div>
      {previews.length>0&&<div className="image-preview-list">{previews.map((url,i)=><div className="image-preview" key={url}><Image src={url} alt={`Reference ${i+1}`} width={116} height={106} unoptimized /><button className="button-outline" disabled={Boolean(job)} onClick={()=>removeReference(i)}><Icon name="close" size={12} />Remove</button></div>)}</div>}
      </div></div></div><div className="generation-controls"><div><label className="field-label" htmlFor="duration">Duration</label><select id="duration" className="select" value={duration} disabled={Boolean(job)} onChange={event => { setDuration(Number(event.target.value)); key.current = null; }}>{(bridge?.capabilities?.durations ?? [8]).map(value => <option key={value} value={value}>{value} sec</option>)}</select></div><div><label className="field-label" htmlFor="resolution">Resolution</label><select id="resolution" className="select" value={resolution} disabled={Boolean(job)} onChange={event => { setResolution(event.target.value); key.current = null; }}>{(bridge?.capabilities?.resolutions ?? ["576x1024"]).map(value => <option key={value} value={value}>{value.replace("x", " × ")}</option>)}</select></div><div><span className="field-label">Format</span><div className="muted-box">9:16</div></div></div>
      <div className="generate-footer"><div><StatusBadge tone={bridge?.readyToGenerate?"success":busy?"warning":"neutral"}>{serviceLabel}</StatusBadge><p className="field-note">{bridge?.readyToGenerate?"Add a prompt and references to get started.":busy?"AI Video is currently busy.":bridge?"AI Video is currently unavailable.":statusFailed?"AI Video is offline.":"Checking video availability…"}</p></div><button className="button" disabled={!canGenerate} onClick={()=>void generate()}><Icon name="sparkles" size={18} />{submitting?"Generating…":"Generate Video"}<Icon name="arrow" size={17} /></button></div>
      {error&&<div className="notice danger" role="alert"><Icon name="alert" size={17} />{error}</div>}
    </section></div>
    {job&&<section className="card panel" style={{marginTop:20}}><div className="connection-head"><h2>{statusText(job)}{job.state !== "FAILED" && job.state !== "WAITING_FOR_GPU" ? ` · ${job.progress ?? 0}%` : ""}</h2><StatusBadge tone={job.state==="COMPLETED"?"success":job.state==="FAILED"?"danger":"warning"}>{statusText(job)}</StatusBadge></div><p className="page-description">{job.prompt}</p><p className="field-note">Created {new Date(job.createdAt).toLocaleString()} · {job.durationSeconds} sec · {(job.resolution ?? "576x1024").replace("x", " × ")} · 9:16 · {job.referenceCount} reference images</p>{activeStates.has(job.state) && job.state !== "WAITING_FOR_GPU" && <progress value={job.progress ?? 0} max={100} aria-label="Video generation progress" />}{job.error&&<p className="login-error" role="alert">{job.error}</p>}{job.state==="WAITING_FOR_GPU"&&<button className="button-outline" disabled={submitting} onClick={()=>void tryWhenIdle()}>Try when idle</button>}{job.state==="COMPLETED"&&<><video className="video-result" controls preload="metadata" src={`/api/ai-video/jobs/${job.id}/artifact`} /><a className="button-outline" href={`/api/ai-video/jobs/${job.id}/artifact`} download={`video-${job.id}.mp4`}><Icon name="download" size={16} />Download Video</a></>}{["COMPLETED","FAILED"].includes(job.state)&&<button className="button-outline" style={{marginLeft:12}} onClick={another}>Generate Another Video</button>}</section>}
    <div className="section-heading"><h2><Icon name="clock" />Generation History</h2><span>Recent videos</span></div><section className="card panel"><div className="tab-row" role="tablist" aria-label="Generation status" style={{marginTop:0}}>{["All","Completed","Failed","Generating"].map(t=><button role="tab" aria-selected={historyTab===t} className={`tab ${historyTab===t?"active":""}`} key={t} onClick={()=>setHistoryTab(t)}>{t}</button>)}</div>{filtered.length?<div className="record-list">{filtered.map(i=><button className="history-row" key={i.id} onClick={()=>setJob(i)}><span className="history-thumbnail">{i.state==="COMPLETED"?<><Icon name="video" size={26} /><video muted preload="metadata" onLoadedMetadata={event=>{event.currentTarget.currentTime=0.1;}} onLoadedData={event=>{event.currentTarget.style.opacity="1";}} src={`/api/ai-video/jobs/${i.id}/artifact`} /></>:<Icon name={i.state==="FAILED"?"alert":"video"} size={26} />}</span><span><strong>{i.prompt.slice(0,110)}{i.prompt.length>110?"…":""}</strong><small>{i.durationSeconds} sec · {(i.resolution ?? "576x1024").replace("x", " × ")} · 9:16 · {i.referenceCount} images · {new Date(i.createdAt).toLocaleString()}</small></span><StatusBadge tone={i.state==="COMPLETED"?"success":i.state==="FAILED"?"danger":"warning"}>{i.state==="COMPLETED"?"Completed":i.state==="FAILED"?"Failed":"Generating"}</StatusBadge></button>)}</div>:<EmptyState title={historyLoading?"Loading generations…":historyFailed?"Generation history unavailable":historyTab==="All"?"No generations yet":`No ${historyTab.toLowerCase()} generations`} detail={historyFailed?"Please try again once the video service is available.":"Your videos will appear here. Select a result to preview or download it."} icon="video" />}</section>
  </>;
}
