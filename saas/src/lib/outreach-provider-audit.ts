import 'server-only';
import type { Session } from './auth';
import { query } from './db';
import { canonicalHash } from './billing-core';
import { requireOperator } from './outreach-provider';
/** Read-only consistency report; never changes attribution or invents an outcome. */
export async function outreachProviderAudit(session: Session, w: string) {
  await requireOperator(session, w);
  const checks: Record<string, number> = {};
  const queries: Record<string, string> = {
    CHANNEL_CREDENTIAL_MISMATCH: "SELECT count(*) n FROM outreach_channels c LEFT JOIN outreach_credential_versions v ON v.credential_id=c.credential_reference AND v.workspace_id=c.workspace_id AND v.channel_id=c.id AND v.provider_identity=c.provider_identity AND v.version=c.credential_version AND v.status='ACTIVE' WHERE c.workspace_id=$1 AND c.provider='TIKTOK_SHOP' AND c.status='CONNECTED' AND v.credential_id IS NULL",
    UNPROVEN_SENT: "SELECT count(*) n FROM outreach_deliveries d JOIN outreach_channels c ON c.id=d.channel_id LEFT JOIN outreach_provider_proofs p ON p.delivery_id=d.id AND p.workspace_id=d.workspace_id AND p.channel_id=d.channel_id AND p.attempt_number=d.attempt_count AND p.provider_identity=c.provider_identity WHERE d.workspace_id=$1 AND c.provider='TIKTOK_SHOP' AND d.state='SENT' AND p.delivery_id IS NULL",
    ATTEMPT_OUTBOX_MISMATCH: "SELECT count(*) n FROM outreach_deliveries d JOIN outreach_channels c ON c.id=d.channel_id LEFT JOIN outreach_outbox o ON o.delivery_id=d.id AND o.workspace_id=d.workspace_id LEFT JOIN outreach_delivery_attempts a ON a.delivery_id=d.id AND a.attempt_number=d.attempt_count WHERE d.workspace_id=$1 AND c.provider='TIKTOK_SHOP' AND (o.delivery_id IS NULL OR (d.attempt_count>0 AND a.id IS NULL) OR (d.state='DISPATCHING' AND o.state<>'CLAIMED') OR (d.state IN('SENT','FAILED','RESTRICTED','CANCELLED','DELIVERY_UNKNOWN') AND o.state<>'COMPLETED'))",
    CANARY_ALLOWANCE_MISMATCH: "SELECT count(*) n FROM outreach_campaigns c JOIN outreach_channels ch ON ch.id=c.channel_id LEFT JOIN outreach_canary_approvals a ON a.id=c.canary_id AND a.workspace_id=c.workspace_id AND a.channel_id=c.channel_id AND a.campaign_id=c.id WHERE c.workspace_id=$1 AND ch.provider='TIKTOK_SHOP' AND (a.id IS NULL OR c.selected_count<>1 OR a.send_attempts>1 OR a.approved_at IS NULL)",
    REAL_UNAUTHORIZED_CREATOR: "SELECT count(*) n FROM outreach_recipients r JOIN outreach_channels c ON c.id=r.channel_id LEFT JOIN outreach_directory_authorizations a ON a.workspace_id=r.workspace_id AND a.channel_id=r.channel_id AND a.creator_key=r.creator_key WHERE r.workspace_id=$1 AND c.provider='TIKTOK_SHOP' AND a.id IS NULL",
    SENT_TOKEN_SETTLEMENT_MISMATCH: "SELECT count(*) n FROM outreach_campaign_billing b JOIN outreach_campaigns c ON c.id=b.campaign_id JOIN outreach_channels ch ON ch.id=c.channel_id WHERE b.workspace_id=$1 AND ch.provider='TIKTOK_SHOP' AND b.status='SETTLED' AND (b.per_send<>10 OR b.captured_tokens<>10*(SELECT count(*) FROM outreach_deliveries d WHERE d.campaign_id=c.id AND d.state='SENT'))"
  };
  for (const [code, sql] of Object.entries(queries)) checks[code] = Number((await query<{
    n: string;
  }>(sql, [w])).rows[0].n);
  const proofs = (await query<{
    delivery_id: string;
    attempt_number: number;
    provider_identity: string;
    message_hash: string;
    message_id: string;
    request_id: string | null;
    proof_hash: string;
    context_valid: boolean;
  }>("SELECT p.*,p.provider_identity=c.provider_identity AND p.message_hash=r.message_hash AND p.attempt_number=d.attempt_count AS context_valid FROM outreach_provider_proofs p JOIN outreach_deliveries d ON d.id=p.delivery_id JOIN outreach_channels c ON c.id=d.channel_id JOIN outreach_recipients r ON r.id=d.recipient_id WHERE p.workspace_id=$1", [w])).rows;
  checks.PROOF_CONTEXT_MISMATCH = proofs.filter(p => !p.context_valid || p.proof_hash !== canonicalHash({
    deliveryId: p.delivery_id,
    attempt: p.attempt_number,
    providerIdentity: p.provider_identity,
    messageHash: p.message_hash,
    messageId: p.message_id,
    requestId: p.request_id
  })).length;
  const unresolved = Number((await query<{
    n: string;
  }>("SELECT count(*) n FROM outreach_deliveries d JOIN outreach_channels c ON c.id=d.channel_id WHERE d.workspace_id=$1 AND c.provider='TIKTOK_SHOP' AND d.state='DELIVERY_UNKNOWN' AND NOT EXISTS(SELECT 1 FROM outreach_provider_proofs p WHERE p.delivery_id=d.id)", [w])).rows[0].n);
  return {
    consistent: Object.values(checks).every(n => n === 0),
    checks,
    unresolvedUnknown: unresolved,
    bulkSending: false
  };
}
