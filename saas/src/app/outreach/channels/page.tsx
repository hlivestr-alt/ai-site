import Link from 'next/link';
import { Shell } from '@/components/shell';
import { OutreachChannels } from '@/components/outreach-channels';
import { pageWorkspace } from '@/lib/page';
import { channelList } from '@/lib/outreach';
import { can, type Role } from '@/lib/permissions';
export default async function OutreachChannelsPage() { const { session, workspaces, current } = await pageWorkspace(), channels = await channelList(session, current.id); return <Shell user={session} workspaces={workspaces} current={current}><div className="outreach-page"><div className="page-heading"><div><p className="eyebrow">OUTREACH</p><h1>Outbound accounts</h1><p>Account authorization belongs to this workspace.</p></div><Link className="button secondary" href="/outreach">Campaign history</Link></div><OutreachChannels workspaceId={current.id} initialChannels={channels.channels} testAvailable={channels.testAvailable} canManage={can(current.role as Role, 'outreach:channel_manage')}/></div></Shell>; }
