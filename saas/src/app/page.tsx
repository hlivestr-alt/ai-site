import { Shell } from "@/components/shell";
import { pageWorkspace } from "@/lib/page";
import { members } from "@/lib/workspaces";

export default async function Home() {
  const { session, workspaces, current } = await pageWorkspace();
  const team = await members(session.userId, current.id);
  return <Shell user={session} workspaces={workspaces} current={current}>
    <div className="page-heading"><div><p className="eyebrow">WORKSPACE OVERVIEW</p><h1>Welcome to {current.name}.</h1><p>Your team space is ready for the next stage.</p></div><span className="pill">{current.role}</span></div>
    <div className="stat-grid"><div className="stat-card"><span>Workspace</span><strong>{current.name}</strong><small>Active</small></div><div className="stat-card"><span>Team members</span><strong>{team.length}</strong><small>With active access</small></div><div className="stat-card"><span>Your role</span><strong>{current.role.toLowerCase()}</strong><small>Server enforced</small></div></div>
    <section className="panel empty-panel"><div className="empty-icon">✦</div><p className="eyebrow">FOUNDATION COMPLETE</p><h2>A place for the work ahead</h2><p>Identity and team access are available now. Content tools, credits and billing will appear when their services are implemented.</p><a className="button primary" href="/settings">Manage workspace <span>→</span></a></section>
  </Shell>;
}
