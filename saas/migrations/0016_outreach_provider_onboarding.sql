-- New customer-owned integration. No native identity, credential or creator backfill.
DO $$ DECLARE c record;BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='outreach_channels'::regclass AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%outbound_capable%' OR pg_get_constraintdef(oid) LIKE '%status%') LOOP EXECUTE format('ALTER TABLE outreach_channels DROP CONSTRAINT %I',c.conname);END LOOP;
END $$;
ALTER TABLE outreach_channels
 ADD COLUMN provider_identity text CHECK(length(provider_identity) BETWEEN 1 AND 120),
 ADD COLUMN granted_scopes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(granted_scopes)='array'),
 ADD COLUMN connected_at timestamptz,ADD COLUMN verified_at timestamptz,
 ADD COLUMN access_expires_at timestamptz,ADD COLUMN refresh_expires_at timestamptz,
 ADD COLUMN credential_version integer NOT NULL DEFAULT 0 CHECK(credential_version>=0),
 ADD COLUMN certification text NOT NULL DEFAULT 'NOT_TESTED' CHECK(certification IN('NOT_TESTED','CANARY_READY','CERTIFIED','FAILED')),
 ADD COLUMN authorization_realm text NOT NULL DEFAULT 'UNCONFIGURED' CHECK(authorization_realm IN('UNCONFIGURED','REAL','TEST_FIXTURE')),
 ADD COLUMN safe_connection_code text,
 ADD COLUMN authorization_state_hash text,
 ADD COLUMN refresh_lease uuid,ADD COLUMN refresh_lease_expires_at timestamptz,
 ADD COLUMN provider_blocked_until timestamptz,
 ADD CHECK(status IN('NOT_CONNECTED','PENDING','CONNECTED','NEEDS_ATTENTION','NEEDS_REAUTH','DISCONNECTED','REVOKED','ERROR')),
 ADD CHECK(NOT outbound_capable OR (status='CONNECTED' AND (provider='TEST' OR (provider='TIKTOK_SHOP' AND provider_identity IS NOT NULL AND credential_reference IS NOT NULL AND granted_scopes ? 'seller.affiliate_messages.write')))),
 ADD CHECK(provider<>'TIKTOK_SHOP' OR status<>'CONNECTED' OR (provider_identity IS NOT NULL AND credential_reference IS NOT NULL AND credential_version>0 AND connected_at IS NOT NULL AND verified_at IS NOT NULL)),
 ADD CHECK(provider<>'TEST' OR (credential_reference IS NULL AND provider_identity IS NULL AND credential_version=0));
CREATE UNIQUE INDEX outreach_provider_account_unique ON outreach_channels(provider,provider_identity) WHERE provider_identity IS NOT NULL;
ALTER TABLE outreach_channel_credentials ADD COLUMN channel_id uuid,ADD COLUMN credential_version integer CHECK(credential_version>0),ADD FOREIGN KEY(workspace_id,channel_id) REFERENCES outreach_channels(workspace_id,id),ADD UNIQUE(workspace_id,channel_id,id);
CREATE TABLE outreach_credential_versions(
 credential_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,channel_id uuid NOT NULL,provider_identity text NOT NULL,version integer NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN('ACTIVE','RETIRED')),created_at timestamptz NOT NULL DEFAULT now(),retired_at timestamptz,
 UNIQUE(channel_id,version),UNIQUE(workspace_id,channel_id,credential_id),
 FOREIGN KEY(workspace_id,channel_id,credential_id) REFERENCES outreach_channel_credentials(workspace_id,channel_id,id),
 CHECK((status='ACTIVE' AND retired_at IS NULL) OR (status='RETIRED' AND retired_at IS NOT NULL)));
CREATE UNIQUE INDEX outreach_one_active_credential ON outreach_credential_versions(channel_id) WHERE status='ACTIVE';
ALTER TABLE outreach_channels ADD FOREIGN KEY(workspace_id,id,credential_reference) REFERENCES outreach_credential_versions(workspace_id,channel_id,credential_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE outreach_oauth_states(
 state_hash text PRIMARY KEY CHECK(length(state_hash)=64),workspace_id uuid NOT NULL,channel_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),session_id uuid NOT NULL,
 expires_at timestamptz NOT NULL,consumed_at timestamptz,pending_ciphertext bytea,pending_key_version integer,finished_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,channel_id) REFERENCES outreach_channels(workspace_id,id),CHECK((pending_ciphertext IS NULL)=(pending_key_version IS NULL)));
CREATE TABLE outreach_directory_authorizations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,channel_id uuid NOT NULL,creator_key text NOT NULL,
 source text NOT NULL CHECK(source='CONTROLLED_PROVIDER_RECIPIENT'),authorized_by uuid NOT NULL REFERENCES users(id),authorized_at timestamptz NOT NULL DEFAULT now(),
 provider_verified_at timestamptz NOT NULL,evidence_hash text NOT NULL CHECK(length(evidence_hash)=64),
 UNIQUE(channel_id,creator_key),UNIQUE(workspace_id,channel_id,creator_key,id),FOREIGN KEY(workspace_id,channel_id) REFERENCES outreach_channels(workspace_id,id));
CREATE TRIGGER outreach_directory_authorization_immutable BEFORE UPDATE OR DELETE ON outreach_directory_authorizations FOR EACH ROW EXECUTE FUNCTION billing_immutable();
ALTER TABLE outreach_creators ADD COLUMN data_authorization_id uuid,ADD FOREIGN KEY(workspace_id,channel_id,creator_key,data_authorization_id) REFERENCES outreach_directory_authorizations(workspace_id,channel_id,creator_key,id);
CREATE TABLE outreach_canary_approvals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL,channel_id uuid NOT NULL,creator_key text NOT NULL,message_hash text NOT NULL CHECK(length(message_hash)=64),
 config_hash text NOT NULL CHECK(length(config_hash)=64),config_snapshot jsonb NOT NULL,prepared_by uuid NOT NULL REFERENCES users(id),approved_by uuid REFERENCES users(id),prepared_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,expires_at timestamptz NOT NULL,
 campaign_id uuid UNIQUE,status text NOT NULL DEFAULT 'PREPARED' CHECK(status IN('PREPARED','APPROVED','QUEUED','ATTEMPTED','SENT','FAILED','UNKNOWN')),
 send_attempts integer NOT NULL DEFAULT 0 CHECK(send_attempts BETWEEN 0 AND 1),send_claimed_at timestamptz,
 UNIQUE(workspace_id,channel_id,id),FOREIGN KEY(workspace_id,channel_id) REFERENCES outreach_channels(workspace_id,id),
 FOREIGN KEY(workspace_id,channel_id,campaign_id) REFERENCES outreach_campaigns(workspace_id,channel_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((approved_at IS NULL)=(approved_by IS NULL)),CHECK((send_attempts=0 AND send_claimed_at IS NULL) OR (send_attempts=1 AND send_claimed_at IS NOT NULL)),
 CHECK(status='PREPARED' OR approved_at IS NOT NULL));
ALTER TABLE outreach_campaigns ADD COLUMN canary_id uuid,ADD FOREIGN KEY(workspace_id,channel_id,canary_id) REFERENCES outreach_canary_approvals(workspace_id,channel_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX outreach_canary_one_campaign ON outreach_campaigns(canary_id) WHERE canary_id IS NOT NULL;
CREATE TABLE outreach_provider_proofs(
 delivery_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,channel_id uuid NOT NULL,attempt_number integer NOT NULL,provider_identity text NOT NULL,
 message_hash text NOT NULL CHECK(length(message_hash)=64),message_id text NOT NULL CHECK(length(message_id) BETWEEN 1 AND 120),request_id text,proof_hash text NOT NULL CHECK(length(proof_hash)=64),accepted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(channel_id,message_id),FOREIGN KEY(workspace_id,channel_id,delivery_id) REFERENCES outreach_deliveries(workspace_id,channel_id,id),FOREIGN KEY(delivery_id,attempt_number) REFERENCES outreach_delivery_attempts(delivery_id,attempt_number));
CREATE TRIGGER outreach_provider_proof_immutable BEFORE UPDATE OR DELETE ON outreach_provider_proofs FOR EACH ROW EXECUTE FUNCTION billing_immutable();
ALTER TABLE outreach_reconciliation_proofs DROP CONSTRAINT outreach_reconciliation_proofs_proof_kind_check;
ALTER TABLE outreach_reconciliation_proofs ADD CHECK(proof_kind IN('ISOLATED_ATOMIC_TEST_PROVIDER','TIKTOK_ACCEPTED_MESSAGE_ID'));
CREATE TABLE outreach_provider_pacing(scope_hash text PRIMARY KEY CHECK(length(scope_hash)=64),next_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
-- Fixture transport has no HTTP destination and is inaccessible outside an owned test DB.
CREATE TABLE outreach_provider_fixtures(channel_id uuid PRIMARY KEY,workspace_id uuid NOT NULL,external_identity text NOT NULL,scenario text NOT NULL DEFAULT 'VALID',api_calls integer NOT NULL DEFAULT 0,message_calls integer NOT NULL DEFAULT 0,refresh_calls integer NOT NULL DEFAULT 0,FOREIGN KEY(workspace_id,channel_id) REFERENCES outreach_channels(workspace_id,id));
CREATE FUNCTION outreach_provider_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Provider history cannot be deleted';END IF;
 IF TG_TABLE_NAME='outreach_channels' THEN
  IF OLD.provider_identity IS NOT NULL AND NEW.provider_identity IS DISTINCT FROM OLD.provider_identity THEN RAISE EXCEPTION 'Provider account cannot be reassigned';END IF;
  IF NEW.credential_version<OLD.credential_version THEN RAISE EXCEPTION 'Credential generation cannot regress';END IF;
 END IF;
 IF TG_TABLE_NAME='outreach_credential_versions' THEN
  IF to_jsonb(NEW)-ARRAY['status','retired_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['status','retired_at'] OR OLD.status='RETIRED' OR NEW.status<>'RETIRED' THEN RAISE EXCEPTION 'Credential version is immutable';END IF;
 END IF;
 IF TG_TABLE_NAME='outreach_canary_approvals' THEN
  IF NEW.status<>OLD.status AND NOT ((OLD.status='PREPARED' AND NEW.status='APPROVED') OR (OLD.status='APPROVED' AND NEW.status='QUEUED') OR (OLD.status='QUEUED' AND NEW.status IN('ATTEMPTED','FAILED','UNKNOWN')) OR (OLD.status='ATTEMPTED' AND NEW.status IN('SENT','FAILED','UNKNOWN')) OR (OLD.status='UNKNOWN' AND NEW.status='SENT')) THEN RAISE EXCEPTION 'Canary transition is not authorized';END IF;
  IF NEW.send_attempts<>OLD.send_attempts AND NOT (OLD.status='QUEUED' AND NEW.status='ATTEMPTED' AND OLD.send_attempts=0 AND NEW.send_attempts=1) THEN RAISE EXCEPTION 'Canary permits one message attempt only';END IF;
  IF to_jsonb(NEW)-ARRAY['approved_by','approved_at','campaign_id','status','send_attempts','send_claimed_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['approved_by','approved_at','campaign_id','status','send_attempts','send_claimed_at'] OR (OLD.approved_at IS NOT NULL AND (NEW.approved_at,NEW.approved_by) IS DISTINCT FROM(OLD.approved_at,OLD.approved_by)) OR (OLD.campaign_id IS NOT NULL AND NEW.campaign_id IS DISTINCT FROM OLD.campaign_id) OR NEW.send_attempts<OLD.send_attempts OR (OLD.send_claimed_at IS NOT NULL AND NEW.send_claimed_at IS DISTINCT FROM OLD.send_claimed_at) THEN RAISE EXCEPTION 'Canary identity and authorization cannot change';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER outreach_provider_channel_guard BEFORE UPDATE OR DELETE ON outreach_channels FOR EACH ROW EXECUTE FUNCTION outreach_provider_identity_guard();
CREATE TRIGGER outreach_credential_lifecycle_guard BEFORE UPDATE OR DELETE ON outreach_credential_versions FOR EACH ROW EXECUTE FUNCTION outreach_provider_identity_guard();
CREATE TRIGGER outreach_canary_identity_guard BEFORE UPDATE OR DELETE ON outreach_canary_approvals FOR EACH ROW EXECUTE FUNCTION outreach_provider_identity_guard();
CREATE FUNCTION outreach_real_delivery_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE c outreach_channels;p outreach_campaigns;a outreach_canary_approvals;BEGIN
 SELECT * INTO c FROM outreach_channels WHERE id=NEW.channel_id;
 IF c.provider<>'TIKTOK_SHOP' THEN RETURN NEW;END IF;
 SELECT * INTO p FROM outreach_campaigns WHERE id=NEW.campaign_id;SELECT * INTO a FROM outreach_canary_approvals WHERE id=p.canary_id;
 IF a.id IS NULL OR p.selected_count<>1 OR a.workspace_id<>NEW.workspace_id OR a.channel_id<>NEW.channel_id OR a.creator_key<>NEW.creator_key OR a.approved_at IS NULL THEN RAISE EXCEPTION 'Real delivery requires exact one-recipient canary approval';END IF;
 IF NEW.state='SENT' AND NOT EXISTS(SELECT 1 FROM outreach_provider_proofs WHERE delivery_id=NEW.id AND workspace_id=NEW.workspace_id AND channel_id=NEW.channel_id AND attempt_number=NEW.attempt_count AND provider_identity=c.provider_identity) THEN RAISE EXCEPTION 'Real sent outcome requires accepted message evidence';END IF;
 IF TG_OP='UPDATE' AND OLD.state='DELIVERY_UNKNOWN' AND NEW.state NOT IN('DELIVERY_UNKNOWN','SENT') THEN RAISE EXCEPTION 'Uncertain real send cannot be guessed or retried';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outreach_real_delivery_required BEFORE INSERT OR UPDATE ON outreach_deliveries FOR EACH ROW EXECUTE FUNCTION outreach_real_delivery_guard();
CREATE FUNCTION outreach_real_channel_reference() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE c outreach_channels;BEGIN
 SELECT * INTO c FROM outreach_channels WHERE id=NEW.id;
 IF c.provider='TIKTOK_SHOP' AND c.status='CONNECTED' AND NOT EXISTS(SELECT 1 FROM outreach_credential_versions v WHERE v.credential_id=c.credential_reference AND v.workspace_id=c.workspace_id AND v.channel_id=c.id AND v.provider_identity=c.provider_identity AND v.version=c.credential_version AND v.status='ACTIVE') THEN RAISE EXCEPTION 'Connected provider identity must match active credential';END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER outreach_real_connection_atomic AFTER INSERT OR UPDATE ON outreach_channels DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION outreach_real_channel_reference();

CREATE FUNCTION outreach_provider_proof_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM outreach_deliveries d JOIN outreach_channels c ON c.id=d.channel_id JOIN outreach_recipients r ON r.id=d.recipient_id JOIN outreach_campaigns p ON p.id=d.campaign_id JOIN outreach_canary_approvals a ON a.id=p.canary_id WHERE d.id=NEW.delivery_id AND d.workspace_id=NEW.workspace_id AND d.channel_id=NEW.channel_id AND c.provider='TIKTOK_SHOP' AND c.provider_identity=NEW.provider_identity AND d.attempt_count=NEW.attempt_number AND r.message_hash=NEW.message_hash AND a.message_hash=NEW.message_hash AND a.send_attempts=1 AND a.status IN('ATTEMPTED','UNKNOWN')) THEN RAISE EXCEPTION 'Provider proof must match dispatched canary attribution';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER outreach_provider_proof_context_guard BEFORE INSERT ON outreach_provider_proofs FOR EACH ROW EXECUTE FUNCTION outreach_provider_proof_context();
