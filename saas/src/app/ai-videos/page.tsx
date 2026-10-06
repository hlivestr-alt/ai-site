import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { VideoCreateForm } from "@/components/video-create-form";
import { pageWorkspace } from "@/lib/page";
import { latestActiveAiVideo, aiVideoHistory, aiVideoOptions, aiVideoProducts } from "@/lib/ai-video";
import { can, type Role } from "@/lib/permissions";

export default async function AiVideosPage(){
  const {session,workspaces,current}=await pageWorkspace();
  const active=await latestActiveAiVideo(session,current.id);
  if(active)redirect(`/ai-videos/${active.id}`);
  const [products,options,history]=await Promise.all([aiVideoProducts(session,current.id),aiVideoOptions(session,current.id),aiVideoHistory(session,current.id)]);
  const canCreate=can(current.role as Role,"future:edit");
  return <Shell user={session} workspaces={workspaces} current={current}><div className="page-heading"><div><p className="eyebrow">CREATE VIDEO</p><h1>AI Videos</h1><p>Generate from a saved Product, then return here to see the result.</p></div></div><section className="panel video-create-panel"><div className="panel-head"><div><p className="eyebrow">NEW GENERATION</p><h2>Create Video</h2><p>Quality is the available tier. Duration and ratio follow the configured model policy.</p></div></div>{products.length?<VideoCreateForm workspaceId={current.id} products={products} options={options} canCreate={canCreate}/>:<p>Add and activate a Product with a verified image before creating a video. <Link href="/products/new">Add Product</Link></p>}</section><section className="panel"><div className="panel-head"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>Video history</h2></div><span className="count">{history.length} recent jobs</span></div>{history.length?<div className="video-history">{history.map(item=><Link className="video-history-row" href={`/ai-videos/${item.id}`} key={item.id}><div><strong>{item.productName}</strong><small>Quality · {item.durationSeconds}s · {item.aspectRatio} · Product v{item.productVersion}</small></div><div><span className="pill">{item.status.replaceAll("_"," ")}</span><small>{new Date(item.created_at).toLocaleString("en-US",{timeZone:"UTC"})} UTC</small></div></Link>)}</div>:<p className="muted">No videos yet. Completed and in-progress Jobs will appear here.</p>}</section></Shell>;
}
