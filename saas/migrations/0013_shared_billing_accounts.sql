-- One authoritative account projection; immutable ledger retains workspace attribution.
LOCK TABLE workspaces,workspace_members,workspace_wallets,token_ledger_entries,billing_quotes,job_billing,payments IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM workspace_wallets w LEFT JOIN (SELECT workspace_id,sum(available_delta) a,sum(reserved_delta) r FROM token_ledger_entries GROUP BY workspace_id) l USING(workspace_id) WHERE w.available_tokens<>coalesce(l.a,0) OR w.reserved_tokens<>coalesce(l.r,0)) THEN RAISE EXCEPTION 'Phase C stopped: wallet/ledger drift'; END IF;
 IF EXISTS(SELECT 1 FROM workspace_wallets w LEFT JOIN (SELECT workspace_id,sum(token_amount) r FROM job_billing WHERE status='RESERVED' GROUP BY workspace_id) b USING(workspace_id) WHERE w.reserved_tokens<>coalesce(b.r,0)) THEN RAISE EXCEPTION 'Phase C stopped: reservation drift'; END IF;
 IF EXISTS(SELECT 1 FROM workspaces w WHERE NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=w.created_by AND m.role='OWNER' AND m.status='ACTIVE')) THEN RAISE EXCEPTION 'Phase C stopped: original creator no longer an owner'; END IF;
 IF EXISTS(SELECT 1 FROM audit_events a JOIN workspaces w ON w.id=a.workspace_id WHERE a.event_type='WORKSPACE_CREATED' AND a.actor_user_id IS NOT NULL AND a.actor_user_id<>w.created_by) THEN RAISE EXCEPTION 'Phase C stopped: conflicting creator evidence'; END IF;
END $$;
CREATE TEMP TABLE phase_c_before ON COMMIT DROP AS SELECT
 (SELECT coalesce(sum(available_tokens),0) FROM workspace_wallets) available,
 (SELECT coalesce(sum(reserved_tokens),0) FROM workspace_wallets) reserved,
 (SELECT count(*) FROM token_ledger_entries) ledger_rows,
 (SELECT md5(coalesce(string_agg(to_jsonb(l)::text,'|' ORDER BY id),'')) FROM token_ledger_entries l) ledger_hash,
 (SELECT md5(coalesce(string_agg(to_jsonb(b)::text,'|' ORDER BY job_id),'')) FROM job_billing b) job_billing_hash,
 (SELECT md5(coalesce(string_agg(to_jsonb(p)::text,'|' ORDER BY id),'')) FROM payments p) payment_hash,
 (SELECT md5(coalesce(string_agg(to_jsonb(q)::text,'|' ORDER BY id),'')) FROM billing_quotes q) quote_hash;
CREATE TEMP TABLE phase_c_mapping ON COMMIT DROP AS
 SELECT w.id AS workspace_id,w.created_by,
 CASE WHEN (SELECT count(*) FROM workspace_members m WHERE m.workspace_id=w.id AND m.role='OWNER' AND m.status='ACTIVE')=1
 THEN 'creator:'||w.created_by::text ELSE 'workspace:'||w.id::text END AS group_key
 FROM workspaces w;
CREATE TABLE billing_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 2 AND 100),
 created_by uuid NOT NULL REFERENCES users(id),legacy_group_key text UNIQUE,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_account_members (
 billing_account_id uuid NOT NULL REFERENCES billing_accounts(id),user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN('OWNER','MANAGER')),status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','REMOVED')),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(billing_account_id,user_id)
);
CREATE TABLE billing_account_wallets (
 billing_account_id uuid PRIMARY KEY REFERENCES billing_accounts(id),available_tokens bigint NOT NULL DEFAULT 0 CHECK(available_tokens>=0),
 reserved_tokens bigint NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION create_billing_account_wallet() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO billing_account_wallets(billing_account_id) VALUES(NEW.id);RETURN NEW;
END $$;
CREATE TRIGGER account_wallet_create AFTER INSERT ON billing_accounts FOR EACH ROW EXECUTE FUNCTION create_billing_account_wallet();
INSERT INTO billing_accounts(name,created_by,legacy_group_key)
 SELECT left(min(w.name)||' account',100),m.created_by,m.group_key FROM phase_c_mapping m JOIN workspaces w ON w.id=m.workspace_id GROUP BY m.created_by,m.group_key;
INSERT INTO billing_account_members(billing_account_id,user_id,role) SELECT id,created_by,'OWNER' FROM billing_accounts;
ALTER TABLE workspaces ADD COLUMN billing_account_id uuid REFERENCES billing_accounts(id);
UPDATE workspaces w SET billing_account_id=a.id FROM phase_c_mapping m JOIN billing_accounts a ON a.legacy_group_key=m.group_key WHERE w.id=m.workspace_id;
ALTER TABLE workspaces ALTER COLUMN billing_account_id SET NOT NULL;
ALTER TABLE workspaces ADD UNIQUE(billing_account_id,id);
UPDATE billing_account_wallets a SET available_tokens=s.a,reserved_tokens=s.r,updated_at=s.updated_at
 FROM (SELECT w.billing_account_id,sum(old.available_tokens)::bigint a,sum(old.reserved_tokens)::bigint r,max(old.updated_at) updated_at FROM workspaces w JOIN workspace_wallets old ON old.workspace_id=w.id GROUP BY w.billing_account_id) s WHERE a.billing_account_id=s.billing_account_id;
DROP TRIGGER workspace_wallet_create ON workspaces;
DROP FUNCTION create_workspace_wallet();
ALTER TABLE job_billing DROP CONSTRAINT job_billing_workspace_id_fkey;
ALTER TABLE token_ledger_entries DROP CONSTRAINT token_ledger_entries_workspace_id_fkey;
ALTER TABLE job_billing ADD FOREIGN KEY(workspace_id) REFERENCES workspaces(id);
ALTER TABLE token_ledger_entries ADD FOREIGN KEY(workspace_id) REFERENCES workspaces(id);
DROP TABLE workspace_wallets;

-- Backfill identities only. Economic values, hashes, IDs, timestamps, and meanings remain intact.
DROP TRIGGER quotes_immutable ON billing_quotes;
DROP TRIGGER ledger_append_only ON token_ledger_entries;
ALTER TABLE billing_quotes ADD COLUMN billing_account_id uuid;
ALTER TABLE job_billing ADD COLUMN billing_account_id uuid;
ALTER TABLE payments ADD COLUMN billing_account_id uuid;
ALTER TABLE token_ledger_entries ADD COLUMN billing_account_id uuid;
ALTER TABLE token_ledger_entries ADD COLUMN idempotency_scope text NOT NULL DEFAULT 'LEGACY_WORKSPACE' CHECK(idempotency_scope IN('LEGACY_WORKSPACE','ACCOUNT'));
UPDATE billing_quotes b SET billing_account_id=w.billing_account_id FROM workspaces w WHERE b.workspace_id=w.id;
UPDATE job_billing b SET billing_account_id=w.billing_account_id FROM workspaces w WHERE b.workspace_id=w.id;
UPDATE payments b SET billing_account_id=w.billing_account_id FROM workspaces w WHERE b.workspace_id=w.id;
UPDATE token_ledger_entries b SET billing_account_id=w.billing_account_id FROM workspaces w WHERE b.workspace_id=w.id;
-- Identity backfills queue the existing deferred reference checks; drain them before ALTER TABLE.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE token_ledger_entries ALTER COLUMN idempotency_scope SET DEFAULT 'ACCOUNT';
CREATE TRIGGER quotes_immutable BEFORE UPDATE OR DELETE ON billing_quotes FOR EACH ROW EXECUTE FUNCTION billing_immutable();
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON token_ledger_entries FOR EACH ROW EXECUTE FUNCTION billing_immutable();
ALTER TABLE billing_quotes ALTER COLUMN billing_account_id SET NOT NULL;
ALTER TABLE job_billing ALTER COLUMN billing_account_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN billing_account_id SET NOT NULL;
ALTER TABLE token_ledger_entries ALTER COLUMN billing_account_id SET NOT NULL;
ALTER TABLE billing_quotes ADD FOREIGN KEY(billing_account_id,workspace_id) REFERENCES workspaces(billing_account_id,id),ADD UNIQUE(billing_account_id,workspace_id,id);
ALTER TABLE payments ADD FOREIGN KEY(billing_account_id,workspace_id) REFERENCES workspaces(billing_account_id,id),ADD UNIQUE(billing_account_id,workspace_id,id);
ALTER TABLE job_billing ADD FOREIGN KEY(billing_account_id,workspace_id) REFERENCES workspaces(billing_account_id,id),
 ADD FOREIGN KEY(billing_account_id,workspace_id,quote_id) REFERENCES billing_quotes(billing_account_id,workspace_id,id),ADD UNIQUE(billing_account_id,workspace_id,job_id);
ALTER TABLE token_ledger_entries ADD FOREIGN KEY(billing_account_id) REFERENCES billing_account_wallets(billing_account_id),
 ADD FOREIGN KEY(billing_account_id,workspace_id) REFERENCES workspaces(billing_account_id,id),
 ADD FOREIGN KEY(billing_account_id,workspace_id,job_id) REFERENCES job_billing(billing_account_id,workspace_id,job_id),
 ADD FOREIGN KEY(billing_account_id,workspace_id,payment_id) REFERENCES payments(billing_account_id,workspace_id,id),
 ADD FOREIGN KEY(billing_account_id,workspace_id,quote_id) REFERENCES billing_quotes(billing_account_id,workspace_id,id),ADD UNIQUE(billing_account_id,workspace_id,id);
ALTER TABLE payments ADD FOREIGN KEY(billing_account_id,workspace_id,purchase_ledger_id) REFERENCES token_ledger_entries(billing_account_id,workspace_id,id);
ALTER TABLE job_billing ADD FOREIGN KEY(billing_account_id,workspace_id,reserve_ledger_id) REFERENCES token_ledger_entries(billing_account_id,workspace_id,id),
 ADD FOREIGN KEY(billing_account_id,workspace_id,capture_ledger_id) REFERENCES token_ledger_entries(billing_account_id,workspace_id,id),
 ADD FOREIGN KEY(billing_account_id,workspace_id,release_ledger_id) REFERENCES token_ledger_entries(billing_account_id,workspace_id,id),
 ADD FOREIGN KEY(billing_account_id,workspace_id,refund_ledger_id) REFERENCES token_ledger_entries(billing_account_id,workspace_id,id);
CREATE UNIQUE INDEX ledger_account_key_once ON token_ledger_entries(billing_account_id,idempotency_key) WHERE idempotency_scope='ACCOUNT';
CREATE INDEX ledger_account_history ON token_ledger_entries(billing_account_id,created_at DESC,id DESC);
CREATE INDEX payments_account_history ON payments(billing_account_id,created_at DESC,id DESC);
ALTER TABLE audit_events ADD COLUMN billing_account_id uuid REFERENCES billing_accounts(id);
ALTER TABLE billing_reconciliation_issues ADD COLUMN billing_account_id uuid REFERENCES billing_accounts(id);

CREATE FUNCTION bind_billing_account() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE expected uuid;BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id THEN RAISE EXCEPTION 'Billing account identity is immutable';END IF;RETURN NEW;
 END IF;
 IF NEW.workspace_id IS NOT NULL THEN
  SELECT billing_account_id INTO expected FROM workspaces WHERE id=NEW.workspace_id;
  IF NEW.billing_account_id IS NULL THEN NEW.billing_account_id=expected;END IF;
  IF NEW.billing_account_id IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Workspace/account mismatch';END IF;
 END IF;
 IF TG_TABLE_NAME='token_ledger_entries' THEN
  IF NEW.idempotency_scope<>'ACCOUNT' THEN RAISE EXCEPTION 'New ledger keys must be account-scoped';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quotes_account_binding BEFORE INSERT ON billing_quotes FOR EACH ROW EXECUTE FUNCTION bind_billing_account();
CREATE TRIGGER job_billing_account_binding BEFORE INSERT OR UPDATE ON job_billing FOR EACH ROW EXECUTE FUNCTION bind_billing_account();
CREATE TRIGGER payments_account_binding BEFORE INSERT OR UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION bind_billing_account();
CREATE TRIGGER ledger_account_binding BEFORE INSERT ON token_ledger_entries FOR EACH ROW EXECUTE FUNCTION bind_billing_account();
CREATE TRIGGER reconciliation_account_binding BEFORE INSERT ON billing_reconciliation_issues FOR EACH ROW EXECUTE FUNCTION bind_billing_account();
CREATE TRIGGER audit_account_binding BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION bind_billing_account();
CREATE FUNCTION workspace_account_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id THEN RAISE EXCEPTION 'Workspace billing account cannot move';END IF;RETURN NEW;
END $$;
CREATE TRIGGER workspace_account_identity BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION workspace_account_immutable();
CREATE FUNCTION account_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (NEW.id,NEW.created_by,NEW.legacy_group_key,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.created_by,OLD.legacy_group_key,OLD.created_at) THEN RAISE EXCEPTION 'Account identity is immutable';END IF;RETURN NEW;
END $$;
CREATE TRIGGER account_identity BEFORE UPDATE OR DELETE ON billing_accounts FOR EACH ROW EXECUTE FUNCTION account_identity_immutable();
CREATE OR REPLACE FUNCTION protect_wallet_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND pg_trigger_depth()<2) OR (TG_OP='INSERT' AND (NEW.available_tokens<>0 OR NEW.reserved_tokens<>0)) THEN RAISE EXCEPTION 'Wallet can only change through ledger';END IF;
 IF TG_OP='UPDATE' AND NEW.billing_account_id<>OLD.billing_account_id THEN RAISE EXCEPTION 'Wallet identity is immutable';END IF;RETURN NEW;
END $$;
CREATE TRIGGER wallet_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON billing_account_wallets FOR EACH ROW EXECUTE FUNCTION protect_wallet_projection();

DO $$ DECLARE before phase_c_before;BEGIN
 SELECT * INTO before FROM phase_c_before;
 IF before.available<>(SELECT coalesce(sum(available_tokens),0) FROM billing_account_wallets) OR before.reserved<>(SELECT coalesce(sum(reserved_tokens),0) FROM billing_account_wallets) THEN RAISE EXCEPTION 'Phase C stopped: global value changed';END IF;
 IF before.ledger_rows<>(SELECT count(*) FROM token_ledger_entries) OR before.ledger_hash IS DISTINCT FROM (SELECT md5(coalesce(string_agg((to_jsonb(l)-'billing_account_id'-'idempotency_scope')::text,'|' ORDER BY id),'')) FROM token_ledger_entries l) THEN RAISE EXCEPTION 'Phase C stopped: historical ledger changed';END IF;
 IF before.job_billing_hash IS DISTINCT FROM (SELECT md5(coalesce(string_agg((to_jsonb(b)-'billing_account_id')::text,'|' ORDER BY job_id),'')) FROM job_billing b) OR before.payment_hash IS DISTINCT FROM (SELECT md5(coalesce(string_agg((to_jsonb(p)-'billing_account_id')::text,'|' ORDER BY id),'')) FROM payments p) OR before.quote_hash IS DISTINCT FROM (SELECT md5(coalesce(string_agg((to_jsonb(q)-'billing_account_id')::text,'|' ORDER BY id),'')) FROM billing_quotes q) THEN RAISE EXCEPTION 'Phase C stopped: historical billing identity changed';END IF;
 IF EXISTS(SELECT 1 FROM billing_account_wallets a LEFT JOIN (SELECT billing_account_id,sum(available_delta) a,sum(reserved_delta) r FROM token_ledger_entries GROUP BY billing_account_id) l USING(billing_account_id) WHERE a.available_tokens<>coalesce(l.a,0) OR a.reserved_tokens<>coalesce(l.r,0)) THEN RAISE EXCEPTION 'Phase C stopped: account ledger drift';END IF;
END $$;

CREATE OR REPLACE FUNCTION apply_token_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b job_billing; p payments; j jobs; q billing_quotes;
BEGIN
 PERFORM 1 FROM billing_account_wallets WHERE billing_account_id=NEW.billing_account_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account wallet not found';END IF;
 IF NEW.job_id IS NOT NULL THEN
  SELECT * INTO b FROM job_billing WHERE job_id=NEW.job_id AND workspace_id=NEW.workspace_id AND billing_account_id=NEW.billing_account_id;
  SELECT * INTO j FROM jobs WHERE id=NEW.job_id;
  IF abs(CASE WHEN NEW.entry_type='CAPTURE' THEN NEW.reserved_delta ELSE NEW.available_delta END)<>b.token_amount THEN RAISE EXCEPTION 'Job amount mismatch'; END IF;
  IF NEW.entry_type='RESERVE' AND (b.status<>'RESERVED' OR NEW.quote_id<>b.quote_id OR j.status<>'QUEUED') THEN RAISE EXCEPTION 'Invalid reservation'; END IF;
  IF NEW.entry_type='CAPTURE' AND (b.status<>'RESERVED' OR j.status<>'SUCCEEDED' OR NOT EXISTS(SELECT 1 FROM content_publications WHERE job_id=j.id) OR NOT EXISTS(SELECT 1 FROM job_artifacts a JOIN job_attempts t ON t.id=a.attempt_id WHERE a.job_id=j.id AND a.status='READY' AND t.status='SUCCEEDED' AND t.attempt_number=j.attempt_count)) THEN RAISE EXCEPTION 'Invalid capture'; END IF;
  IF NEW.entry_type='RELEASE' AND (b.status<>'RESERVED' OR j.status NOT IN('FAILED','CANCELLED') OR EXISTS(SELECT 1 FROM provider_executions WHERE job_id=j.id AND state IN('SUBMITTING','SUBMISSION_UNKNOWN','SUBMITTED','RUNNING','OUTPUT_PENDING'))) THEN RAISE EXCEPTION 'Outcome not definite'; END IF;
  IF NEW.entry_type='REFUND' AND b.status<>'CAPTURED' THEN RAISE EXCEPTION 'Invalid token refund'; END IF;
 END IF;
 IF NEW.entry_type='PURCHASE' THEN
  SELECT * INTO p FROM payments WHERE id=NEW.payment_id AND workspace_id=NEW.workspace_id AND billing_account_id=NEW.billing_account_id;
  IF p.status<>'PAID' OR p.token_amount<>NEW.available_delta THEN RAISE EXCEPTION 'Invalid purchase'; END IF;
 END IF;
 UPDATE billing_account_wallets SET available_tokens=available_tokens+NEW.available_delta,reserved_tokens=reserved_tokens+NEW.reserved_delta,updated_at=now() WHERE billing_account_id=NEW.billing_account_id;
 RETURN NEW;
END $$;
