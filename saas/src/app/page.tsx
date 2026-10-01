import { Shell } from "@/components/shell";
import { pageWorkspace } from "@/lib/page";
import { members } from "@/lib/workspaces";
import { productCounts } from "@/lib/products";
import { customerJobCounts } from "@/lib/jobs";
import { can, type Role } from "@/lib/permissions";
import Link from "next/link";
import {billingSummary} from "@/lib/billing";
import {workflowCounts} from "@/lib/workflows";
import {contentCounts} from "@/lib/content";

export default async function Home() {
  const { session, workspaces, current } = await pageWorkspace();
  const [team,counts,jobCounts,libraryCounts,wallet,workflow] = await Promise.all([members(session.userId, current.id),productCounts(session,current.id),customerJobCounts(session,current.id),contentCounts(session,current.id),billingSummary(session,current.id),workflowCounts(session,current.id)]);
  const canEdit=can(current.role as Role,"future:edit");
  return <Shell user={session} workspaces={workspaces} current={current}>
    <div className="page-heading"><div><p className="eyebrow">WORKSPACE OVERVIEW</p><h1>Welcome to {current.name}.</h1><p>Your team space is ready for the next stage.</p></div><span className="pill">{current.role}</span></div>
    <div className="stat-grid"><div className="stat-card"><span>Active products</span><strong>{counts.products}</strong><small>In this workspace</small></div><div className="stat-card"><span>Ready assets</span><strong>{counts.assets}</strong><small>Private references</small></div><div className="stat-card"><span>Active jobs</span><strong>{jobCounts.active}</strong><small><Link href="/jobs">View processing</Link></small></div><div className="stat-card"><span>Team members</span><strong>{team.length}</strong><small>With active access</small></div></div>
    <div className="stat-grid wallet-counts"><div className="stat-card"><span>Available tokens</span><strong>{BigInt(wallet.availableTokens).toLocaleString()}</strong><small>{BigInt(wallet.reservedTokens).toLocaleString()} reserved · <Link href="/billing">Buy Tokens</Link></small></div></div><div className="stat-grid content-counts"><div className="stat-card"><span>Content Assets</span><strong>{libraryCounts.assets}</strong><small><Link href="/content">Open Content Library</Link></small></div><div className="stat-card"><span>Pending Review</span><strong>{libraryCounts.pending}</strong><small><Link href="/review">Open Review Center</Link></small></div></div>
    <div className="stat-grid workflow-counts"><div className="stat-card"><span>Active Workflows</span><strong>{workflow.active}</strong><small><Link href="/workflows">Open Workflows</Link></small></div><div className="stat-card"><span>Needs Review</span><strong>{workflow.review}</strong><small>Workflow review gates</small></div><div className="stat-card"><span>Needs Funds</span><strong>{workflow.funds}</strong><small>Wallet or budget blocked</small></div></div><section className="panel empty-panel"><div className="empty-icon">◇</div><p className="eyebrow">PRODUCT CATALOG</p><h2>{counts.products?"Your product references are ready":"Add your first product"}</h2><p>{counts.products?"Manage versioned information, accuracy instructions and private reference media.":"Create a product draft, upload real references and save its accuracy instructions."}</p><Link className="button primary" href={canEdit?"/products/new":"/products"}>{canEdit?"Add product":"View products"} <span>→</span></Link></section>
  </Shell>;
}
