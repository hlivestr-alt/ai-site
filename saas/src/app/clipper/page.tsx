import Link from "next/link";
import {Shell} from "@/components/shell";
import {ClipperCreateForm} from "@/components/clipper-create-form";
import {pageWorkspace} from "@/lib/page";
import {clipperHistory} from "@/lib/clipper";
import {sourceList} from "@/lib/sources";
import {aiVideoProducts} from "@/lib/ai-video";
import {maxClipperSourceBytes} from "@/lib/clipper-core";
import {can,type Role} from "@/lib/permissions";
import {clipperConfigured,clipAnalyzerProvider} from "@/lib/operational-config";
export default async function ClipperPage(){const {session,workspaces,current}=await pageWorkspace();const [sources,products,history]=await Promise.all([sourceList(session,current.id),aiVideoProducts(session,current.id),clipperHistory(session,current.id)]);return <Shell user={session} workspaces={workspaces} current={current}><div className="page-heading"><div><p className="eyebrow">CREATE CLIPS</p><h1>Clipper</h1><p>Upload a private source, choose your goal, and return later for your clips.</p></div></div><section className="panel"><h2>Start clipping</h2>{!clipperConfigured()&&<p className="notice">Clipping is unavailable until the analyzer is configured.</p>}<ClipperCreateForm workspaceId={current.id} initialSources={sources} products={products} canCreate={can(current.role as Role,"future:edit")&&clipperConfigured()} maxBytes={maxClipperSourceBytes()} simulation={clipAnalyzerProvider()==="fake"}/></section><section className="panel"><h2>Clipper history</h2>{history.length?<div className="video-history">{history.map(item=><Link href={`/clipper/${item.id}`} className="video-history-row" key={item.id}><div><strong>{item.filename}</strong><small>{String(item.productName||"Generic clipping")} · Requested {item.requested} · Found {item.found}</small></div><div><span className="pill">{item.status.replaceAll("_"," ")}</span><small>Created {new Date(item.created_at).toLocaleString("en-US",{timeZone:"Asia/Shanghai"})}{item.finished_at?` · Finished ${new Date(item.finished_at).toLocaleString("en-US",{timeZone:"Asia/Shanghai"})}`:""}</small></div></Link>)}</div>:<p className="muted">Your clipping jobs will appear here.</p>}</section></Shell>;}
