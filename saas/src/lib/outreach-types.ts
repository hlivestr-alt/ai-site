// Safe browser/server constants and types. No credentials or server imports.
export const outreachStates = ['QUEUED', 'SENDING', 'PAUSE_REQUESTED', 'PAUSED', 'CANCEL_REQUESTED', 'CANCELLED', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'DELIVERY_UNKNOWN'] as const;
export type OutreachState = typeof outreachStates[number];
export const terminalCampaignStates = ['CANCELLED', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'];
export const deliveryStates = ['PENDING', 'DISPATCHING', 'RETRYABLE', 'SENT', 'RESTRICTED', 'FAILED', 'DELIVERY_UNKNOWN', 'CANCELLED'] as const;
export type DeliveryState = typeof deliveryStates[number];
export const rankingMetrics = ['GMV', 'UNITS_SOLD', 'FOLLOWERS', 'AVG_VIDEO_VIEWS', 'AVG_LIVE_VIEWERS', 'ENGAGEMENT_RATE', 'TIKTOK_RELEVANCE'] as const;
export type RankingMetric = typeof rankingMetrics[number];
export type Filters = {
    keyword?: string;
    categoryIds?: string[];
    minFollowers?: number;
    maxFollowers?: number;
    minGmv?: number;
    maxGmv?: number;
    minUnitsSold?: number;
    minAvgVideoViews?: number;
    minAvgLiveViewers?: number;
    minEngagementRate?: number;
};
export type CampaignConfig = {
    canaryId?: string;
    channelId: string;
    name: string;
    productName: string;
    messageTemplate: string;
    targetCount: number;
    cooldownDays: number;
    rankingMetric: RankingMetric;
    rankingDirection: 'ASC' | 'DESC';
    filters: Filters;
};
export type Creator = {
    id: string;
    creator_key: string;
    display_name: string;
    username: string;
    category_ids: string[];
    followers: number | null;
    gmv: string | null;
    gmv_currency: string | null;
    units_sold: number | null;
    video_views: number | null;
    live_viewers: number | null;
    engagement: number | null;
    ordinal: number;
};
export type Contact = {
    do_not_contact: boolean;
    unknown_delivery_id: string | null;
    last_contacted_at: Date | null;
    reserved: boolean;
};
export type SelectedRecipient = {
    creatorKey: string;
    displayName: string;
    username: string;
    followers: number | null;
    categories: string[];
    ordinal: number;
    message: string;
    metrics: {
        gmv: string | null;
        gmvCurrency: string | null;
        unitsSold: number | null;
        videoViews: number | null;
        liveViewers: number | null;
        engagement: number | null;
    };
};
