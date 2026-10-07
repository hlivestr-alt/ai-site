"use client";
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from './api';
import { useTokenQuote, TokenQuoteView, type TokenQuote } from './token-quote';
import { rankingMetrics, type CampaignConfig, type Filters } from '@/lib/outreach-types';
import type { safeChannel } from '@/lib/outreach';
type Channel = ReturnType<typeof safeChannel>;
type Draft = {
    config: CampaignConfig;
    key: string;
    campaignId: string | null;
};
type OutreachQuote = TokenQuote & {
    selectedCount: number;
    perSuccessfulSend: string;
    summary: {
        shortfall: number;
    };
    recipients: {
        displayName: string;
        followers: number | null;
    }[];
};
export function OutreachForm({ workspaceId, channels, canCreate, canSend }: {
    workspaceId: string;
    channels: Channel[];
    canCreate: boolean;
    canSend: boolean;
}) {
    const router = useRouter(), storage = `outreach-draft:${workspaceId}`;
    const [draft, setDraft] = useState<Draft>({ config: { channelId: channels.find(c => c.outboundCapable)?.id || '', name: 'New outreach campaign', productName: '', messageTemplate: 'Hi {{creator_display_name}}, I would like to discuss a collaboration. Please reply if you are interested. Thank you!', targetCount: 5, cooldownDays: 30, rankingMetric: 'FOLLOWERS', rankingDirection: 'DESC', filters: {} }, key: '', campaignId: null }), [loaded, setLoaded] = useState(false), [pending, setPending] = useState(false), [recovering, setRecovering] = useState(true), [error, setError] = useState('');
    useEffect(() => { queueMicrotask(() => { let saved: Draft | null = null; try {
        saved = JSON.parse(sessionStorage.getItem(storage) || 'null');
    }
    catch { } if (saved?.config && typeof saved.key === 'string' && saved.key.length >= 8)
        setDraft(saved);
    else
        setDraft(d => ({ ...d, key: crypto.randomUUID() })); setLoaded(true); }); }, [storage]);
    useEffect(() => { if (!loaded || !draft.key || draft.campaignId)
        return; if (!draft.config.channelId) {
        queueMicrotask(() => setRecovering(false));
        return;
    } let current = true; queueMicrotask(() => setRecovering(true)); api<{
        campaign: {
            id: string;
        } | null;
    }>(`/api/workspaces/${workspaceId}/outreach/campaigns/recover`, 'POST', { ...draft.config, idempotencyKey: draft.key }).then(r => { if (current && r.campaign)
        setDraft(d => ({ ...d, campaignId: r.campaign!.id })); }).catch(() => { }).finally(() => { if (current)
        setRecovering(false); }); return () => { current = false; }; }, [loaded, workspaceId, draft.key, draft.campaignId, draft.config]);
    useEffect(() => { if (loaded)
        sessionStorage.setItem(storage, JSON.stringify(draft)); }, [storage, draft, loaded]);
    const connected = channels.some(c => c.id === draft.config.channelId && c.outboundCapable), quotes = useTokenQuote(workspaceId, 'OUTREACH', draft.config as unknown as Record<string, unknown>, loaded && canCreate && connected && !draft.campaignId && !recovering), quote = quotes.quote as OutreachQuote | null;
    function change(patch: Partial<CampaignConfig>) { setDraft(d => ({ config: { ...d.config, ...patch }, key: crypto.randomUUID(), campaignId: null })); setError(''); }
    function filter(key: keyof Filters, value: string) { const f = { ...draft.config.filters }; if (!value.trim())
        delete f[key];
    else if (key === 'keyword')
        f.keyword = value;
    else if (key === 'categoryIds')
        f.categoryIds = value.split(',').map(v => v.trim()).filter(Boolean);
    else
        Object.assign(f, { [key]: Number(value) }); change({ filters: f }); }
    async function send(event: FormEvent) { event.preventDefault(); if (!quote || !quote.affordable || !canSend || pending || recovering || !draft.key || draft.campaignId)
        return; setPending(true); setError(''); try {
        const r = await api<{
            campaign: {
                id: string;
            };
        }>(`/api/workspaces/${workspaceId}/outreach/campaigns`, 'POST', { ...draft.config, idempotencyKey: draft.key, quoteId: quote.id, quoteHash: quote.quoteHash });
        setDraft(d => ({ ...d, campaignId: r.campaign.id }));
        sessionStorage.setItem(storage, JSON.stringify({ ...draft, campaignId: r.campaign.id }));
        router.push(`/outreach/${r.campaign.id}`);
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'The campaign could not be submitted.');
    }
    finally {
        setPending(false);
    } }
    return <form className="outreach-form" onSubmit={send}><section className="panel"><h2>Campaign and sender</h2><div className="outreach-grid"><label>Campaign name<input maxLength={120} required value={draft.config.name} onChange={e => change({ name: e.target.value })}/></label><label>Outbound account<select aria-label="Outbound account" value={draft.config.channelId} onChange={e => change({ channelId: e.target.value })}><option value="">Choose a connected account</option>{channels.filter(c => c.outboundCapable).map(c => <option key={c.id} value={c.id}>{c.label}{c.provider === 'TEST' ? ' · TEST' : ''}</option>)}</select></label></div>{!connected && <p className="notice">Connect an authorized account before sending. <Link href="/outreach/channels">Manage outbound accounts →</Link></p>}<p className="muted">Real sending is not available yet. TEST accounts use controlled recipients and send no external messages.</p></section><section className="panel"><h2>Targeting</h2><div className="outreach-grid"><label>Recipient target<input aria-label="Recipient target" type="number" min={1} max={500} value={draft.config.targetCount} onChange={e => change({ targetCount: Number(e.target.value) })}/></label><label>Contact cooldown (days)<input type="number" min={0} max={3650} value={draft.config.cooldownDays} onChange={e => change({ cooldownDays: Number(e.target.value) })}/></label><label>Rank by<select value={draft.config.rankingMetric} onChange={e => change({ rankingMetric: e.target.value as CampaignConfig['rankingMetric'] })}>{rankingMetrics.map(m => <option key={m} value={m}>{({ GMV: 'GMV (USD)', UNITS_SOLD: 'Units sold', FOLLOWERS: 'Followers', AVG_VIDEO_VIEWS: 'Video views', AVG_LIVE_VIEWERS: 'Live viewers', ENGAGEMENT_RATE: 'Engagement', TIKTOK_RELEVANCE: 'Discovery relevance' })[m]}</option>)}</select></label><label>Order<select value={draft.config.rankingDirection} onChange={e => change({ rankingDirection: e.target.value as 'ASC' | 'DESC' })}><option value="DESC">Highest first</option><option value="ASC">Lowest first</option></select></label><label>Creator keyword<input maxLength={100} value={draft.config.filters.keyword || ''} onChange={e => filter('keyword', e.target.value)}/></label><label>Creator category<select value={draft.config.filters.categoryIds?.[0] || ''} onChange={e => filter('categoryIds', e.target.value)}><option value="">Any available category</option><option value="beauty">Beauty</option><option value="lifestyle">Lifestyle</option></select></label><details className="outreach-filters"><summary>Additional metric filters</summary><div className="outreach-grid">{(['minFollowers', 'maxFollowers', 'minGmv', 'maxGmv', 'minUnitsSold', 'minAvgVideoViews', 'minAvgLiveViewers', 'minEngagementRate'] as const).map(k => <label key={k}>{({ minFollowers: 'Minimum followers', maxFollowers: 'Maximum followers', minGmv: 'Minimum GMV (USD)', maxGmv: 'Maximum GMV (USD)', minUnitsSold: 'Minimum units sold', minAvgVideoViews: 'Minimum video views', minAvgLiveViewers: 'Minimum live viewers', minEngagementRate: 'Minimum engagement' })[k]}<input type="number" min={0} step={k.includes('Gmv') || k === 'minEngagementRate' ? 'any' : 1} value={draft.config.filters[k] ?? ''} onChange={e => filter(k, e.target.value)}/></label>)}</div></details></div></section><section className="panel"><h2>Message</h2><label>Product name (for the product_name variable)<input maxLength={120} value={draft.config.productName} onChange={e => change({ productName: e.target.value })}/></label><label>Campaign message<textarea aria-label="Campaign message" required maxLength={2000} rows={8} value={draft.config.messageTemplate} onChange={e => change({ messageTemplate: e.target.value })}/></label><p className="muted">Variables: {'{{creator_display_name}}'}, {'{{product_name}}'}, {'{{campaign_name}}'}. Messages are saved exactly for each selected recipient.</p></section><section className="panel outreach-submit"><h2>Recipients and Tokens</h2>{quote && <><p><strong>{quote.selectedCount} recipients selected</strong>{quote.summary.shortfall > 0 ? ` · ${quote.summary.shortfall} fewer than your target` : ''}</p><p>{quote.perSuccessfulSend} Tokens per confirmed successful send.</p><ul className="outreach-preview">{quote.recipients.map((r, i) => <li key={i}>{r.displayName}{r.followers !== null ? ` · ${r.followers.toLocaleString('en-US')} followers` : ''}</li>)}</ul></>}<TokenQuoteView {...quotes} settlementText="This is the maximum reservation. Only confirmed successful sends are charged. Unsent amounts are released; uncertain deliveries keep Tokens reserved until checked."/>{draft.campaignId && <p className="notice">This draft already has a saved campaign. <Link href={`/outreach/${draft.campaignId}`}>Open campaign</Link> <button type="button" className="text-button" onClick={() => { setDraft(d => ({ ...d, key: crypto.randomUUID(), campaignId: null })); quotes.refreshQuote(); }}>Start another campaign</button></p>}{!canSend && <p className="notice">Your role cannot send campaigns.</p>}{error && <p className="notice error" role="alert">{error} Retry unchanged settings to recover the same request.</p>}<button className="button primary" disabled={!canSend || !connected || !quote?.affordable || pending || recovering || !!draft.campaignId}>{pending ? 'Saving campaign…' : 'Send Campaign'}</button><p className="muted">You can leave after submission and return to campaign history.</p></section></form>;
}
