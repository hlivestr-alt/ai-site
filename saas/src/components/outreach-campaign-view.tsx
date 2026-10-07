"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from './api';
import type { campaignDetail, recipientList } from '@/lib/outreach';
type Campaign = Awaited<ReturnType<typeof campaignDetail>>;
type Recipient = Awaited<ReturnType<typeof recipientList>>[number];
export function campaignStateLabel(state: string) { return ({ QUEUED: 'Queued', SENDING: 'Sending', PAUSE_REQUESTED: 'Pausing', PAUSED: 'Paused', CANCEL_REQUESTED: 'Cancelling', CANCELLED: 'Cancelled', COMPLETED: 'Completed', COMPLETED_WITH_ERRORS: 'Completed with issues', FAILED: 'Failed', DELIVERY_UNKNOWN: 'Waiting for delivery status' } as Record<string, string>)[state] || state.replaceAll('_', ' ').toLowerCase(); }
export function OutreachCampaignView({ workspaceId, initial, initialRecipients }: {
    workspaceId: string;
    initial: Campaign;
    initialRecipients: Recipient[];
}) {
    const [campaign, setCampaign] = useState(initial), [recipients, setRecipients] = useState(initialRecipients), [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [message, setMessage] = useState<{
        name: string;
        message: string;
    } | null>(null);
    const path = `/api/workspaces/${workspaceId}/outreach/campaigns/${campaign.id}`, terminal = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED'].includes(campaign.state);
    async function reload() { const [c, r] = await Promise.all([api<{
            campaign: Campaign;
        }>(path), api<{
            recipients: Recipient[];
        }>(`${path}/recipients`)]); setCampaign(c.campaign); setRecipients(r.recipients); }
    useEffect(() => { if (terminal && campaign.billing.status === 'SETTLED')
        return; const timer = setInterval(() => { void reload().catch(() => { }); }, 2000); return () => clearInterval(timer); });
    async function control(action: string) { setPending(true); setError(''); setNotice(''); try {
        if (action === 'reconcile') {
            const result = await api<{
                resolved: number;
            }>(`${path}/reconcile`, 'POST', {});
            setNotice(result.resolved ? 'Delivery status was checked and updated.' : 'Delivery is still uncertain. No message has been resent.');
        }
        else
            await api(`${path}/control`, 'POST', { action });
        await reload();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'The action could not be completed.');
    }
    finally {
        setPending(false);
    } }
    async function showMessage(r: Recipient) { try {
        const result = await api<{
            message: string;
        }>(`${path}/recipients/${r.id}/message`);
        setMessage({ name: r.display_name, message: result.message });
    }
    catch {
        setError('The saved message could not be opened.');
    } }
    const time = (v: Date | string | null) => v ? new Date(v).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }) : 'Waiting to start';
    return <><section className="panel"><div className="outreach-status"><span className="pill" aria-live="polite">{campaignStateLabel(campaign.state)}</span><p>Outbound account: {campaign.channel.label}</p><p>Started: {time(campaign.startedAt)}{campaign.completedAt ? ` · Completed: ${time(campaign.completedAt)}` : ''}</p></div><div className="outreach-counts">{Object.entries(campaign.counts).map(([label, count]) => <div className="review-card" key={label}><strong>{count}</strong><span>{label === 'unknown' ? 'Delivery unknown' : label[0].toUpperCase() + label.slice(1)}</span></div>)}</div>{campaign.counts.unknown > 0 && <p className="notice">Some deliveries have no confirmed outcome. They will not be resent automatically, and Tokens remain reserved until their status is confirmed.</p>}{campaign.cancelRequested && <p className="notice">Unsent deliveries are cancelled. Messages already sent remain in history; an active delivery may still finish.</p>}{campaign.canManage && !terminal && <div className="outreach-actions">{!campaign.paused && !campaign.cancelRequested && <button type="button" className="button secondary" disabled={pending} onClick={() => void control('pause')}>Pause</button>}{campaign.paused && !campaign.cancelRequested && <button type="button" className="button secondary" disabled={pending} onClick={() => void control('resume')}>Resume</button>}{!campaign.cancelRequested && <button type="button" className="button secondary" disabled={pending} onClick={() => void control('cancel')}>Cancel campaign</button>}{campaign.counts.unknown > 0 && <button type="button" className="button primary" disabled={pending} onClick={() => void control('reconcile')}>Check delivery status</button>}</div>}{notice && <p className="notice" role="status">{notice}</p>}{error && <p className="notice error" role="alert">{error}</p>}</section><section className="panel"><h2>Campaign Tokens</h2><p>Maximum reservation: <strong>{campaign.billing.reservedMaximum} Tokens</strong> · Internal beta price: {campaign.billing.perSuccessfulSend} Tokens per confirmed send.</p><p>Charged: {campaign.billing.capturedTokens} Tokens · Released: {campaign.billing.releasedTokens} Tokens · {campaign.billing.status === 'SETTLED' ? 'Settled' : 'Reserved pending final delivery status'}</p><Link href="/billing">View shared account balance →</Link></section><section className="panel"><h2>Recipients</h2><div className="outreach-recipient-list">{recipients.map(r => <div className="outreach-recipient" key={r.id}><div><strong>{r.display_name}</strong><small>{r.username}</small></div><span className="pill">{campaignStateLabel(r.state)}</span><button type="button" className="text-button" onClick={() => void showMessage(r)}>View message</button></div>)}</div>{message && <div className="review-card outreach-message"><strong>Saved message for {message.name}</strong><p>{message.message}</p><button type="button" className="text-button" onClick={() => setMessage(null)}>Close message</button></div>}</section><section className="panel"><h2>Saved targeting</h2><p>Target: {campaign.config.targetCount} · Selected: {campaign.counts.selected} · Cooldown: {campaign.config.cooldownDays} days</p><p>Message and recipients are frozen for this campaign. Start a new campaign to use different settings.</p><Link href="/outreach">Return to Outreach history →</Link></section></>;
}
