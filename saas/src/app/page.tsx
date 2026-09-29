import { Shell } from "@/components/shell";
import { pageWorkspace } from "@/lib/page";
import { members } from "@/lib/workspaces";
import { productCounts } from "@/lib/products";
import { can, type Role } from "@/lib/permissions";
import Link from "next/link";

export default async function Home() {
  const { session, workspaces, current } = await pageWorkspace();
  const [team,counts] = await Promise.all([members(session.userId, current.id),productCounts(session,current.id)]);
  const canEdit=can(current.role as Role,"future:edit");
  return <Shell user={session} workspaces={workspaces} current={current}>
    <div className="page-heading"><div><p className="eyebrow">WORKSPACE OVERVIEW</p><h1>Welcome to {current.name}.</h1><p>Your team space is ready for the next stage.</p></div><span className="pill">{current.role}</span></div>
    <div className="stat-grid"><div className="stat-card"><span>Active products</span><strong>{counts.products}</strong><small>In this workspace</small></div><div className="stat-card"><span>Ready assets</span><strong>{counts.assets}</strong><small>Private references</small></div><div className="stat-card"><span>Team members</span><strong>{team.length}</strong><small>With active access</small></div></div>
    <section className="panel empty-panel"><div className="empty-icon">◇</div><p className="eyebrow">PRODUCT CATALOG</p><h2>{counts.products?"Your product references are ready":"Add your first product"}</h2><p>{counts.products?"Manage versioned information, accuracy instructions and private reference media.":"Create a product draft, upload real references and save its accuracy instructions."}</p><Link className="button primary" href={canEdit?"/products/new":"/products"}>{canEdit?"Add product":"View products"} <span>→</span></Link></section>
  </Shell>;
}
