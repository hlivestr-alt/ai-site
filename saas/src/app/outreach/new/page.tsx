import Link from 'next/link';
import { Shell } from '@/components/shell';
import { OutreachForm } from '@/components/outreach-form';
import { pageWorkspace } from '@/lib/page';
import { channelList } from '@/lib/outreach';
import { approvedCanariesForForm } from '@/lib/outreach-canary';
import { can, type Role } from '@/lib/permissions';
export default async function NewOutreachPage() { const { session, workspaces, current } = await pageWorkspace(), channels = await channelList(session, current.id); return <Shell user={session} workspaces={workspaces} current={current}><div className="outreach-page"><div className="page-heading"><div><p className="eyebrow">OUTREACH</p><h1>New Campaign</h1><p>Review selected recipients and Tokens, then send with one action.</p></div><Link className="button secondary" href="/outreach">Campaign history</Link></div><OutreachForm workspaceId={current.id} channels={channels.channels} canaries={await approvedCanariesForForm(session, current.id)} canCreate={can(current.role as Role, 'outreach:create')} canSend={can(current.role as Role, 'outreach:send')}/></div></Shell>; }
