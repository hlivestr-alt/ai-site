import { AppError, isUuid } from './core';
export * from './outreach-types';
import { rankingMetrics, type OutreachState, type DeliveryState, type RankingMetric, type Filters, type CampaignConfig, type Creator, type Contact, type SelectedRecipient } from './outreach-types';
function text(v: unknown, label: string, min: number, max: number) { if (typeof v !== 'string' || v.trim().length < min || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))
    throw new AppError(400, `${label} is invalid.`); return v.trim(); }
function whole(v: unknown, min: number, max: number, label: string) { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    throw new AppError(400, `${label} is out of range.`); return v; }
export function operationKey(v: unknown) { if (typeof v !== 'string' || !/^[A-Za-z0-9:_-]{8,160}$/.test(v))
    throw new AppError(400, 'A stable campaign request identity is required.'); return v; }
export function renderMessage(template: string, values: {
    creator_display_name: string;
    product_name: string;
    campaign_name: string;
}) { const rendered = template.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key: string) => { const k = key.trim(); if (!Object.hasOwn(values, k))
    throw new AppError(400, 'Use only creator_display_name, product_name and campaign_name variables.'); return values[k as keyof typeof values]; }); if (/{{|}}/.test(rendered) || !rendered.trim() || rendered.length > 2000)
    throw new AppError(400, 'Rendered messages must be 1–2,000 characters with valid variables.'); return rendered; }
export function validateCampaign(raw: Record<string, unknown>): CampaignConfig {
    const allowed = ['channelId', 'name', 'productName', 'messageTemplate', 'targetCount', 'cooldownDays', 'rankingMetric', 'rankingDirection', 'filters', 'operation', 'idempotencyKey', 'quoteId', 'quoteHash'];
    if (Object.keys(raw).some(k => !allowed.includes(k)))
        throw new AppError(400, 'Unsupported campaign setting.');
    if (typeof raw.channelId !== 'string' || !isUuid(raw.channelId))
        throw new AppError(400, 'Choose a connected workspace channel.');
    const name = text(raw.name, 'Campaign name', 1, 120), productName = text(raw.productName ?? '', 'Product name', 0, 120), messageTemplate = text(raw.messageTemplate, 'Message', 1, 2000);
    renderMessage(messageTemplate, { creator_display_name: 'QA Creator', product_name: productName, campaign_name: name });
    if (/{{\s*product_name\s*}}/.test(messageTemplate) && !productName)
        throw new AppError(400, 'Product name is required by this message.');
    if (!rankingMetrics.includes(raw.rankingMetric as RankingMetric) || !['ASC', 'DESC'].includes(String(raw.rankingDirection)))
        throw new AppError(400, 'Unsupported recipient ordering.');
    const filter = raw.filters ?? {};
    if (!filter || typeof filter !== 'object' || Array.isArray(filter))
        throw new AppError(400, 'Filters are invalid.');
    const source = filter as Record<string, unknown>, filters: Filters = {};
    const numeric = ['minFollowers', 'maxFollowers', 'minGmv', 'maxGmv', 'minUnitsSold', 'minAvgVideoViews', 'minAvgLiveViewers', 'minEngagementRate'];
    for (const [key, value] of Object.entries(source)) {
        if (key === 'keyword')
            filters.keyword = text(value, 'Keyword', 0, 100);
        else if (key === 'categoryIds') {
            if (!Array.isArray(value) || value.length > 20 || value.some(v => typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(v)))
                throw new AppError(400, 'Categories are invalid.');
            filters.categoryIds = [...new Set(value)] as string[];
        }
        else if (numeric.includes(key)) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000000000 || (['minFollowers', 'maxFollowers', 'minUnitsSold', 'minAvgVideoViews', 'minAvgLiveViewers'].includes(key) && !Number.isSafeInteger(value)) || (key === 'minEngagementRate' && value > 100))
                throw new AppError(400, 'Recipient metric bounds are invalid.');
            Object.assign(filters, { [key]: value });
        }
        else
            throw new AppError(400, 'Unsupported recipient filter.');
    }
    for (const [min, max] of [['minFollowers', 'maxFollowers'], ['minGmv', 'maxGmv']] as const)
        if (filters[min] !== undefined && filters[max] !== undefined && filters[min]! > filters[max]!)
            throw new AppError(400, 'Minimum cannot exceed maximum.');
    return { channelId: raw.channelId, name, productName, messageTemplate, targetCount: whole(raw.targetCount, 1, 500, 'Target count'), cooldownDays: whole(raw.cooldownDays, 0, 3650, 'Cooldown'), rankingMetric: raw.rankingMetric as RankingMetric, rankingDirection: raw.rankingDirection as 'ASC' | 'DESC', filters };
}
export function matchesFilters(c: Creator, f: Filters) { if (f.keyword && !`${c.username} ${c.display_name}`.toLowerCase().includes(f.keyword.toLowerCase()))
    return false; if (f.categoryIds?.length && !f.categoryIds.some(id => c.category_ids.includes(id)))
    return false; const bounds: [
    number | undefined,
    number | null,
    boolean
][] = [[f.minFollowers, c.followers, false], [f.maxFollowers, c.followers, true], [f.minGmv, c.gmv === null ? null : Number(c.gmv), false], [f.maxGmv, c.gmv === null ? null : Number(c.gmv), true], [f.minUnitsSold, c.units_sold, false], [f.minAvgVideoViews, c.video_views, false], [f.minAvgLiveViewers, c.live_viewers, false], [f.minEngagementRate, c.engagement, false]]; if ((f.minGmv !== undefined || f.maxGmv !== undefined) && c.gmv_currency !== 'USD')
    return false; return bounds.every(([bound, value, max]) => bound === undefined || (value !== null && Number.isFinite(value) && (max ? value <= bound : value >= bound))); }
export function rankingValue(c: Creator, metric: RankingMetric) { const value = ({ GMV: c.gmv_currency === 'USD' && c.gmv !== null ? Number(c.gmv) : null, UNITS_SOLD: c.units_sold, FOLLOWERS: c.followers, AVG_VIDEO_VIEWS: c.video_views, AVG_LIVE_VIEWERS: c.live_viewers, ENGAGEMENT_RATE: c.engagement, TIKTOK_RELEVANCE: -c.ordinal })[metric]; return value ?? Number.MIN_SAFE_INTEGER; }
export function selectRecipients(config: CampaignConfig, creators: Creator[], contacts: Map<string, Contact>, now = new Date()) {
    const seen = new Set<string>(), excluded: Record<string, number> = {}, selected: SelectedRecipient[] = [];
    let eligible = 0;
    const skip = (reason: string) => { excluded[reason] = (excluded[reason] || 0) + 1; };
    for (const c of [...creators].sort((a, b) => (rankingValue(a, config.rankingMetric) - rankingValue(b, config.rankingMetric)) * (config.rankingDirection === 'ASC' ? 1 : -1) || a.ordinal - b.ordinal || a.creator_key.localeCompare(b.creator_key))) {
        if (seen.has(c.creator_key)) {
            skip('DUPLICATE');
            continue;
        }
        seen.add(c.creator_key);
        const contact = contacts.get(c.creator_key);
        const reason = !matchesFilters(c, config.filters) ? 'FILTER_MISMATCH' : config.rankingMetric === 'GMV' && c.gmv_currency !== 'USD' ? 'CURRENCY_MISMATCH' : contact?.do_not_contact ? 'DO_NOT_CONTACT' : contact?.unknown_delivery_id ? 'DELIVERY_UNKNOWN' : contact?.reserved ? 'ACTIVE_RESERVATION' : contact?.last_contacted_at && contact.last_contacted_at.getTime() > now.getTime() - config.cooldownDays * 86400000 ? 'COOLDOWN' : null;
        if (reason) {
            skip(reason);
            continue;
        }
        eligible++;
        if (selected.length >= config.targetCount)
            continue;
        selected.push({ creatorKey: c.creator_key, displayName: c.display_name, username: c.username, followers: c.followers, categories: c.category_ids.slice(0, 3), ordinal: c.ordinal, message: renderMessage(config.messageTemplate, { creator_display_name: c.display_name, product_name: config.productName, campaign_name: config.name }), metrics: { gmv: c.gmv, gmvCurrency: c.gmv_currency, unitsSold: c.units_sold, videoViews: c.video_views, liveViewers: c.live_viewers, engagement: c.engagement } });
    }
    return { selected, summary: { requested: config.targetCount, selected: selected.length, eligible, shortfall: Math.max(0, config.targetCount - selected.length), excluded } };
}
export function settlementAmounts(total: bigint, perSend: bigint, states: DeliveryState[]) { if (states.some(s => ['PENDING', 'DISPATCHING', 'RETRYABLE', 'DELIVERY_UNKNOWN'].includes(s)))
    return null; const captured = BigInt(states.filter(s => s === 'SENT').length) * perSend; if (captured > total || captured < 0)
    throw new AppError(409, 'Campaign settlement does not match its reservation.'); return { captured, released: total - captured }; }
export function aggregateState(states: DeliveryState[], paused: boolean, cancelled: boolean): OutreachState { const active = states.includes('DISPATCHING'), pending = states.some(s => s === 'PENDING' || s === 'RETRYABLE'); if (active)
    return cancelled ? 'CANCEL_REQUESTED' : paused ? 'PAUSE_REQUESTED' : 'SENDING'; if (states.includes('DELIVERY_UNKNOWN'))
    return 'DELIVERY_UNKNOWN'; if (cancelled)
    return 'CANCELLED'; if (paused && pending)
    return 'PAUSED'; if (pending)
    return 'QUEUED'; return states.every(s => s === 'SENT') ? 'COMPLETED' : states.every(s => s === 'FAILED') ? 'FAILED' : 'COMPLETED_WITH_ERRORS'; }
