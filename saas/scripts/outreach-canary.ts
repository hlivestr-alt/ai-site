// Private operator tool. This command never reads native sender credentials.
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool, query, transaction } from '../src/lib/db';
import { AppError, audit } from '../src/lib/core';
import type { Session } from '../src/lib/auth';
import { requireOperator, realChannel } from '../src/lib/outreach-provider';
import { registerControlledRecipient, prepareCanary, approveCanary } from '../src/lib/outreach-canary';
import { outreachProviderAudit } from '../src/lib/outreach-provider-audit';
import { quoteOutreach, recoverCampaign, sendCampaign } from '../src/lib/outreach';
import type { CampaignConfig } from '../src/lib/outreach-core';
const option = (name: string) => process.argv[process.argv.indexOf(name) + 1];
async function main() {
  try {
    const action = process.argv[2],
      workspace = option('--workspace'),
      email = option('--actor-email');
    if (!process.argv.includes('--workspace') || !process.argv.includes('--actor-email')) throw new AppError(400, 'Workspace and operator identity are required.');
    // Use an existing active operator session; no password/token command arguments.
    const row = (await query<{
      id: string;
      user_id: string;
      email: string;
      display_name: string;
      expires_at: Date;
    }>("SELECT s.id,s.user_id,u.email,u.display_name,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1 AND u.status='ACTIVE' AND s.revoked_at IS NULL AND s.expires_at>now() ORDER BY s.created_at DESC LIMIT 1", [email])).rows[0];
    if (!row) throw new AppError(403, 'Sign in as the authorized operator first.');
    const session: Session = {
      id: row.id,
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      expiresAt: row.expires_at,
      activeWorkspaceId: workspace
    };
    await requireOperator(session, workspace);
    let result: unknown;
    if (action === 'audit') result = await outreachProviderAudit(session, workspace);else if (action === 'register-recipient') {
      if (!process.argv.includes('--controlled-recipient-authorized')) throw new AppError(400, 'Explicit controlled-recipient authorization is required.');
      result = await registerControlledRecipient(session, workspace, option('--channel'), option('--creator-open-id'));
    } else if (action === 'prepare') {
      const message = await readFile(option('--message-file'), 'utf8');
      const prepared = await prepareCanary(session, workspace, {
        channelId: option('--channel'),
        name: 'Controlled provider certification',
        productName: '',
        messageTemplate: message.trim(),
        targetCount: 1,
        cooldownDays: 30,
        rankingMetric: 'FOLLOWERS',
        rankingDirection: 'DESC',
        filters: {}
      });
      result = {
        id: prepared.id,
        status: prepared.status,
        maximumExternalSends: 1,
        billing: prepared.billing
      };
    } else if (action === 'approve') {
      if (!process.argv.includes('--confirm-one-controlled-message')) throw new AppError(400, 'Obtain explicit human approval for one controlled message before approving.');
      result = await approveCanary(session, workspace, option('--canary'));
    } else if (action === 'send') {
      if (!process.argv.includes('--confirm-one-controlled-message')) throw new AppError(400, 'Explicit approval for one controlled message is required.');
      const id = option('--canary'),
        approval = (await query<{
          config_snapshot: CampaignConfig;
        }>('SELECT config_snapshot FROM outreach_canary_approvals WHERE workspace_id=$1 AND id=$2', [workspace, id])).rows[0];
      if (!approval) throw new AppError(404, 'Approved canary not found.');
      const config = { ...approval.config_snapshot, canaryId: id };
      const recovered = await recoverCampaign(session, workspace, { ...config, idempotencyKey: `canary:${id}` });
      if (recovered) {
        console.log(JSON.stringify({ campaignId: recovered.id, maximumExternalSends: 1 }));
        return;
      }
      const quote = await quoteOutreach(session, workspace, config);
      const campaign = await sendCampaign(session, workspace, {
        ...config,
        idempotencyKey: `canary:${id}`,
        quoteId: quote.id,
        quoteHash: quote.quoteHash
      });
      result = {
        campaignId: campaign.id,
        maximumExternalSends: 1
      };
    } else if (action === 'certify') {
      if (!process.argv.includes('--receipt-confirmed')) throw new AppError(400, 'Manual receipt confirmation is required.');
      result = await transaction(async db => {
        await requireOperator(session, workspace, db);
        const a = (await db.query<{
          channel_id: string;
          campaign_id: string;
          status: string;
          send_attempts: number;
        }>('SELECT * FROM outreach_canary_approvals WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [workspace, option('--canary')])).rows[0];
        if (!a || a.status !== 'SENT' || a.send_attempts !== 1) throw new AppError(409, 'One accepted message is required for certification.');
        const channel = await realChannel(db, workspace, a.channel_id, true);
        const valid = (await db.query("SELECT 1 FROM outreach_deliveries d JOIN outreach_provider_proofs p ON p.delivery_id=d.id AND p.attempt_number=d.attempt_count JOIN outreach_campaign_billing b ON b.campaign_id=d.campaign_id WHERE d.workspace_id=$1 AND d.campaign_id=$2 AND d.state='SENT' AND p.provider_identity=$3 AND b.status='SETTLED' AND b.token_amount=10 AND b.captured_tokens=10 AND b.released_tokens=0", [workspace, a.campaign_id, channel.provider_identity])).rowCount;
        if (valid !== 1) throw new AppError(409, 'Delivery proof and settlement must agree before certification.');
        await db.query("UPDATE outreach_channels SET certification='CERTIFIED',updated_at=now() WHERE id=$1", [channel.id]);
        await audit(db, {
          workspaceId: workspace,
          actorUserId: session.userId,
          type: 'OUTREACH_CANARY_RECEIPT_CONFIRMED',
          targetType: 'outreach_campaign',
          targetId: a.campaign_id,
          metadata: {
            externalMessages: 1,
            capturedTokens: '10',
            bulkSending: false,
            correlationId: randomUUID()
          }
        });
        return {
          certified: true,
          bulkSending: false
        };
      });
    } else throw new AppError(400, 'Use register-recipient, prepare, approve, send or certify.');
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(JSON.stringify({
      component: 'outreach-canary',
      status: e instanceof AppError ? e.status : 503,
      code: e instanceof AppError ? e.safeCode || 'CANARY_ACTION_REJECTED' : 'CANARY_ACTION_UNAVAILABLE'
    }));
    process.exitCode = 1;
  } finally {
    await pool().end();
  }
}
void main();
