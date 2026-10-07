import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Session } from './auth';
import { query, transaction, type DbClient } from './db';
import { AppError, audit, isUuid } from './core';
import { canonicalHash } from './billing-core';
import { validateCampaign, renderMessage, type CampaignConfig } from './outreach-core';
import { realChannel, activeCredential, providerFor, requireOperator, realChannelSendable, type RealChannel } from './outreach-provider';
export interface CreatorDirectoryProvider {
  kind: 'TEST' | 'CONTROLLED_PROVIDER_RECIPIENT';
  authorizedCreator(db: DbClient, c: RealChannel, key: string): Promise<boolean>;
}
export const controlledDirectory: CreatorDirectoryProvider = {
  kind: 'CONTROLLED_PROVIDER_RECIPIENT',
  async authorizedCreator(db, c, key) {
    return !!(await db.query('SELECT 1 FROM outreach_creators r JOIN outreach_directory_authorizations a ON a.id=r.data_authorization_id AND a.workspace_id=r.workspace_id AND a.channel_id=r.channel_id AND a.creator_key=r.creator_key WHERE r.workspace_id=$1 AND r.channel_id=$2 AND r.creator_key=$3', [c.workspace_id, c.id, key])).rowCount;
  }
};
const baseConfig = (c: CampaignConfig) => {
  const rest = {
    ...c
  };
  delete rest.canaryId;
  return rest;
};
export async function registerControlledRecipient(session: Session, w: string, id: string, key: string) {
  await requireOperator(session, w);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(key) || key === '0') throw new AppError(400, 'Use the exact provider Creator Open ID for one controlled recipient.');
  const c = await realChannel({
      query
    }, w, id),
    credential = await activeCredential(c),
    provider = await providerFor(c);
  const raw = await provider.creator(credential, key);
  if (raw.creator_open_id !== key) throw new AppError(409, 'The provider did not supply exact recipient-identity evidence.');
  return transaction(async db => {
    await requireOperator(session, w, db);
    const current = await realChannel(db, w, id, true);
    if (current.status !== 'CONNECTED' || current.credential_version !== c.credential_version) throw new AppError(409, 'Connection changed.');
    const prior = (await db.query('SELECT creator_key FROM outreach_directory_authorizations WHERE workspace_id=$1 AND channel_id=$2', [w, id])).rows;
    if (prior.length && prior.some(r => r.creator_key !== key)) throw new AppError(409, 'Only one controlled certification recipient is supported.');
    if (prior.length) return {
      registered: true,
      existing: true
    };
    const authorization = randomUUID(),
      evidenceHash = canonicalHash({
        provider: 'TIKTOK_SHOP',
        account: c.provider_identity,
        creator: key,
        method: 'EXACT_PROVIDER_CREATOR_FIELD'
      });
    await db.query("INSERT INTO outreach_directory_authorizations(id,workspace_id,channel_id,creator_key,source,authorized_by,provider_verified_at,evidence_hash) VALUES($1,$2,$3,$4,'CONTROLLED_PROVIDER_RECIPIENT',$5,now(),$6)", [authorization, w, id, key, session.userId, evidenceHash]);
    const numeric = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1000000000000 ? v : null;
    await db.query("INSERT INTO outreach_creators(workspace_id,channel_id,creator_key,display_name,username,category_ids,followers,ordinal,data_authorization_id) VALUES($1,$2,$3,'Controlled QA recipient','controlled_qa','[]',$4,1,$5)", [w, id, key, numeric(raw.follower_count), authorization]);
    await audit(db, {
      workspaceId: w,
      actorUserId: session.userId,
      type: 'OUTREACH_CONTROLLED_RECIPIENT_AUTHORIZED',
      targetType: 'outreach_channel',
      targetId: id,
      metadata: {
        source: 'CONTROLLED_PROVIDER_RECIPIENT',
        recipients: 1
      }
    });
    return {
      registered: true,
      existing: false
    };
  });
}
export async function prepareCanary(session: Session, w: string, raw: Record<string, unknown>) {
  await requireOperator(session, w);
  const config = validateCampaign(raw);
  if (config.targetCount !== 1 || config.canaryId || config.messageTemplate.length > 500) throw new AppError(400, 'Certification requires exactly one recipient and a benign message of at most 500 characters.');
  return transaction(async db => {
    await requireOperator(session, w, db);
    const c = await realChannel(db, w, config.channelId, true);
    if (c.status !== 'CONNECTED' || !c.outbound_capable) throw new AppError(409, 'Connect and verify this owned account first.');
    const recipients = (await db.query<{
      creator_key: string;
    }>('SELECT creator_key FROM outreach_directory_authorizations WHERE workspace_id=$1 AND channel_id=$2', [w, c.id])).rows;
    if (recipients.length !== 1 || !(await controlledDirectory.authorizedCreator(db, c, recipients[0].creator_key))) throw new AppError(409, 'Authorize exactly one controlled provider recipient first.');
    const message = renderMessage(config.messageTemplate, {
        creator_display_name: 'Controlled QA recipient',
        product_name: config.productName,
        campaign_name: config.name
      }),
      id = randomUUID();
    await db.query('INSERT INTO outreach_canary_approvals(id,workspace_id,channel_id,creator_key,message_hash,config_hash,config_snapshot,prepared_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now()+interval \'30 minutes\')', [id, w, c.id, recipients[0].creator_key, canonicalHash(message), canonicalHash(baseConfig(config)), JSON.stringify(baseConfig(config)), session.userId]);
    await db.query("UPDATE outreach_channels SET certification='CANARY_READY',updated_at=now() WHERE id=$1", [c.id]);
    await audit(db, {
      workspaceId: w,
      actorUserId: session.userId,
      type: 'OUTREACH_CANARY_PREPARED',
      targetType: 'outreach_canary',
      targetId: id,
      metadata: {
        maxExternalSends: 1,
        reservedTokens: '10',
        approved: false
      }
    });
    return {
      id,
      config: {
        ...config,
        canaryId: id
      },
      maximumExternalSends: 1,
      billing: {
        reserve: '10',
        captureOnConfirmedSend: '10',
        releaseOnDefiniteFailure: '10'
      },
      status: 'WAITING_FOR_OPERATOR_APPROVAL'
    };
  });
}
/** Only an authorized operator may call this after the human's explicit canary approval. */
export async function approveCanary(session: Session, w: string, id: string) {
  await requireOperator(session, w);
  if (!isUuid(id)) throw new AppError(404, 'Canary not found.');
  return transaction(async db => {
    await requireOperator(session, w, db);
    const a = (await db.query<{
      channel_id: string;
      status: string;
      expires_at: Date;
    }>('SELECT channel_id,status,expires_at FROM outreach_canary_approvals WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [w, id])).rows[0];
    if (!a || a.status !== 'PREPARED' || a.expires_at.getTime() <= Date.now()) throw new AppError(409, 'Canary is not pending fresh approval.');
    const c = await realChannel(db, w, a.channel_id, true);
    if (c.status !== 'CONNECTED') throw new AppError(409, 'Account needs attention.');
    await db.query("UPDATE outreach_canary_approvals SET status='APPROVED',approved_by=$1,approved_at=now() WHERE id=$2", [session.userId, id]);
    await audit(db, {
      workspaceId: w,
      actorUserId: session.userId,
      type: 'OUTREACH_CANARY_APPROVED',
      targetType: 'outreach_canary',
      targetId: id,
      metadata: {
        maxExternalSends: 1
      }
    });
    return {
      approved: true,
      maxExternalSends: 1
    };
  });
}
export async function validateCanary(db: DbClient, c: RealChannel, config: CampaignConfig, queued = false) {
  if (!realChannelSendable(c) || config.targetCount !== 1 || !config.canaryId || !isUuid(config.canaryId)) throw new AppError(409, 'Real sending is disabled. Certification requires one explicitly approved controlled canary.');
  const a = (await db.query<{
    id: string;
    creator_key: string;
    config_hash: string;
    message_hash: string;
    status: string;
    expires_at: Date;
    approved_at: Date | null;
    approved_by: string | null;
    send_attempts: number;
  }>('SELECT * FROM outreach_canary_approvals WHERE workspace_id=$1 AND channel_id=$2 AND id=$3 FOR UPDATE', [c.workspace_id, c.id, config.canaryId])).rows[0];
  if (!a || a.config_hash !== canonicalHash(baseConfig(config)) || !a.approved_at || a.expires_at.getTime() <= Date.now() || a.status !== (queued ? 'QUEUED' : 'APPROVED') || a.send_attempts !== 0 || !(await controlledDirectory.authorizedCreator(db, c, a.creator_key))) throw new AppError(409, 'The canary authorization is unavailable or does not match this request.');
  if (!(await db.query("SELECT 1 FROM workspace_members m JOIN users u ON u.id=m.user_id JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND m.role IN('OWNER','ADMIN') AND u.status='ACTIVE' AND w.status='ACTIVE'", [c.workspace_id, a.approved_by])).rowCount) throw new AppError(409, 'The operator authorization is no longer active.');
  return a;
}
export async function bindCanary(db: DbClient, c: RealChannel, config: CampaignConfig, campaignId: string, selected: {
  creatorKey: string;
  message: string;
}[]) {
  const a = await validateCanary(db, c, config);
  if (selected.length !== 1 || selected[0].creatorKey !== a.creator_key || canonicalHash(selected[0].message) !== a.message_hash) throw new AppError(409, 'Selected recipient or frozen message differs from the approved canary.');
  await db.query("UPDATE outreach_canary_approvals SET status='QUEUED',campaign_id=$1 WHERE id=$2 AND status='APPROVED'", [campaignId, a.id]);
  await audit(db, {
    workspaceId: c.workspace_id,
    type: 'OUTREACH_CANARY_QUEUED',
    targetType: 'outreach_campaign',
    targetId: campaignId,
    metadata: {
      recipients: 1,
      maximumExternalSends: 1
    }
  });
}
export async function approvedCanariesForForm(session: Session, w: string) {
  try {
    await requireOperator(session, w);
  } catch {
    return [];
  }
  const rows = (await query<{
    id: string;
    channel_id: string;
    config_snapshot: CampaignConfig;
  }>("SELECT id,channel_id,config_snapshot FROM outreach_canary_approvals WHERE workspace_id=$1 AND status='APPROVED' AND expires_at>now() AND send_attempts=0 ORDER BY prepared_at DESC", [w])).rows;
  const result: CampaignConfig[] = [];
  for (const row of rows) {
    const c = await realChannel({
      query
    }, w, row.channel_id);
    if (realChannelSendable(c)) result.push({
      ...row.config_snapshot,
      canaryId: row.id
    });
  }
  return result;
}
