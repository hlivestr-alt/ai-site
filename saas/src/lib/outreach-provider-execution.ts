import 'server-only';
import { query, transaction } from './db';
import { AppError, audit } from './core';
import { canonicalHash } from './billing-core';
import { campaignFor } from './outreach';
import { validateCanary } from './outreach-canary';
import { activeCredential, realChannel, realChannelSendable, providerFor, markConnectionAttention, blockProvider } from './outreach-provider';
import { OutreachProviderError } from './outreach-provider-core';
import type { ClaimedDelivery, ProviderOutcome } from './outreach-worker';
/** Uses the existing delivery lease, frozen recipient, approval and accounting path. */
export async function sendOwnedProvider(d: ClaimedDelivery): Promise<ProviderOutcome> {
  let sendClaimed = false;
  const initial = await realChannel({
    query
  }, d.workspace_id, d.channel_id);
  try {
    if (!realChannelSendable(initial)) return {
      state: 'FAILED',
      code: 'REAL_SEND_UNAVAILABLE'
    };
    const credential = await activeCredential(initial);
    const provider = await providerFor(initial, async () => {
      // Consume the sole external message attempt immediately before transport.
      // A crash after this transaction is ambiguous; the approval cannot be replayed.
      await transaction(async db => {
        const channel = await realChannel(db, d.workspace_id, d.channel_id, true);
        const campaign = await campaignFor(db, d.workspace_id, d.campaign_id, true);
        const current = (await db.query<ClaimedDelivery>("SELECT d.*,r.frozen_message,r.message_hash FROM outreach_deliveries d JOIN outreach_recipients r ON r.id=d.recipient_id AND r.workspace_id=d.workspace_id WHERE d.id=$1 AND d.workspace_id=$2 AND d.state='DISPATCHING' AND d.lease_id=$3 AND d.lease_expires_at>now() FOR UPDATE OF d", [d.id, d.workspace_id, d.lease_id])).rows[0];
        if (!current || channel.credential_version !== initial.credential_version || campaign.paused_at || campaign.cancel_requested_at || !realChannelSendable(channel)) throw new AppError(409, 'The approved dispatch boundary changed.');
        const approval = await validateCanary(db, channel, campaign.config_snapshot, true);
        if (approval.creator_key !== current.creator_key || approval.message_hash !== current.message_hash || canonicalHash(current.frozen_message) !== current.message_hash || current.frozen_message !== d.frozen_message) throw new AppError(409, 'Approved recipient or message changed.');
        const contact = (await db.query<{
          do_not_contact: boolean;
          unknown_delivery_id: string | null;
          last_contacted_at: Date | null;
          last_delivery_id: string | null;
        }>('SELECT * FROM outreach_contact_state WHERE channel_id=$1 AND creator_key=$2', [channel.id, current.creator_key])).rows[0];
        const reservation = (await db.query('SELECT delivery_id FROM outreach_reservations WHERE workspace_id=$1 AND channel_id=$2 AND creator_key=$3', [d.workspace_id, channel.id, current.creator_key])).rows[0];
        if (contact?.do_not_contact || contact?.unknown_delivery_id || contact?.last_contacted_at && contact.last_delivery_id !== d.id && contact.last_contacted_at.getTime() > Date.now() - campaign.config_snapshot.cooldownDays * 86400000 || reservation?.delivery_id !== d.id) throw new AppError(409, 'The recipient is no longer eligible.');
        await db.query("UPDATE outreach_canary_approvals SET status='ATTEMPTED',send_attempts=1,send_claimed_at=now() WHERE id=$1 AND send_attempts=0 AND status='QUEUED'", [approval.id]);
        await audit(db, {
          workspaceId: d.workspace_id,
          type: 'OUTREACH_CANARY_DISPATCH_STARTED',
          targetType: 'outreach_campaign',
          targetId: d.campaign_id,
          metadata: {
            attempt: d.attempt_count,
            maximumExternalSends: 1,
            fixture: channel.authorization_realm === 'TEST_FIXTURE'
          }
        });
      });
      sendClaimed = true;
    });
    const conversationId = await provider.conversation(credential, d.creator_key);
    const outcome = await provider.message(credential, conversationId, d.frozen_message);
    if (!sendClaimed) return {
      state: 'FAILED',
      code: 'APPROVED_DISPATCH_CHANGED'
    };
    if (outcome.code === 'PROVIDER_RATE_LIMIT') await blockProvider(initial, Math.max(1000, outcome.retryAfterMs || 60000));
    if (outcome.state === 'SENT' && outcome.messageId) {
      // Proof commits independently of completion, surviving a lost worker reply.
      await transaction(async db => {
        const channel = await realChannel(db, d.workspace_id, d.channel_id, true);
        if (channel.provider_identity !== initial.provider_identity) throw new AppError(409, 'Provider attribution changed.');
        const evidence = {
          deliveryId: d.id,
          attempt: d.attempt_count,
          providerIdentity: channel.provider_identity,
          messageHash: d.message_hash,
          messageId: outcome.messageId,
          requestId: outcome.requestId || null
        };
        await db.query('INSERT INTO outreach_provider_proofs(delivery_id,workspace_id,channel_id,attempt_number,provider_identity,message_hash,message_id,request_id,proof_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(delivery_id) DO NOTHING', [d.id, d.workspace_id, d.channel_id, d.attempt_count, channel.provider_identity, d.message_hash, outcome.messageId, outcome.requestId || null, canonicalHash(evidence)]);
      });
    }
    return {
      state: outcome.state,
      code: outcome.code,
      retryAfterMs: outcome.retryAfterMs
    };
  } catch (e) {
    if (e instanceof OutreachProviderError && ['AUTH', 'PERMISSION'].includes(e.category)) {
      await markConnectionAttention(d.workspace_id, d.channel_id, 'AUTHORIZATION_REQUIRED', undefined, {
        version: initial.credential_version
      });
      return {
        state: 'FAILED',
        code: 'AUTHORIZATION_REQUIRED'
      };
    }
    if (sendClaimed) return {
      state: 'DELIVERY_UNKNOWN',
      code: 'PROVIDER_RESPONSE_UNKNOWN'
    };
    if (e instanceof OutreachProviderError && ['RATE_LIMIT', 'PRE_SEND_TEMPORARY', 'UNKNOWN'].includes(e.category)) {
      const delay = e.category === 'RATE_LIMIT' ? Math.max(1000, e.retryAfterMs || 60000) : 1000;
      if (e.category === 'RATE_LIMIT') await blockProvider(initial, delay);
      return {
        state: 'RETRYABLE',
        code: e.category === 'RATE_LIMIT' ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_PRE_SEND_TEMPORARY',
        retryAfterMs: delay
      };
    }
    return {
      state: e instanceof OutreachProviderError && e.category === 'RESTRICTED' ? 'RESTRICTED' : 'FAILED',
      code: 'PROVIDER_PRE_SEND_REJECTED'
    };
  }
}
export async function updateCanaryOutcome(delivery: ClaimedDelivery, state: string, db: import('./db').DbClient) {
  await db.query("UPDATE outreach_canary_approvals a SET status=$1 FROM outreach_campaigns c WHERE c.id=$2 AND a.id=c.canary_id AND a.status IN('QUEUED','ATTEMPTED','UNKNOWN')", [state === 'SENT' ? 'SENT' : state === 'DELIVERY_UNKNOWN' ? 'UNKNOWN' : 'FAILED', delivery.campaign_id]);
  if (state !== 'RETRYABLE') await audit(db, {
    workspaceId: delivery.workspace_id,
    type: state === 'SENT' ? 'OUTREACH_CANARY_SENT' : state === 'DELIVERY_UNKNOWN' ? 'OUTREACH_CANARY_UNKNOWN' : 'OUTREACH_CANARY_FAILED',
    targetType: 'outreach_campaign',
    targetId: delivery.campaign_id,
    metadata: {
      outcome: state,
      receiptConfirmationRequired: state === 'SENT'
    }
  });
}
