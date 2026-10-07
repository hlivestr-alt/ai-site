import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Shell } from '@/components/shell';
import { OutreachCampaignView } from '@/components/outreach-campaign-view';
import { pageWorkspace } from '@/lib/page';
import { campaignDetail, recipientList } from '@/lib/outreach';
import { AppError } from '@/lib/core';
export default async function OutreachCampaignPage({ params }: {
    params: Promise<{
        campaignId: string;
    }>;
}) { const { session, workspaces, current } = await pageWorkspace(), { campaignId } = await params; const [campaign, recipients] = await Promise.all([campaignDetail(session, current.id, campaignId), recipientList(session, current.id, campaignId)]).catch(e => { if (e instanceof AppError && e.status === 404)
    notFound(); throw e; }); return <Shell user={session} workspaces={workspaces} current={current}><div className="outreach-page"><div className="page-heading"><div><p className="eyebrow">OUTREACH CAMPAIGN</p><h1>{campaign.name}</h1><p>Saved recipients, delivery progress and shared account Tokens.</p></div><Link className="button secondary" href="/outreach">Campaign history</Link></div><OutreachCampaignView workspaceId={current.id} initial={campaign} initialRecipients={recipients}/></div></Shell>; }
