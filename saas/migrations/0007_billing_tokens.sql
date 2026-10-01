-- Integer accounting. Ledger is authoritative; wallets are a transactionally maintained projection.
CREATE TABLE workspace_wallets (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id), available_tokens bigint NOT NULL DEFAULT 0 CHECK(available_tokens>=0),
 reserved_tokens bigint NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO workspace_wallets(workspace_id) SELECT id FROM workspaces;
CREATE FUNCTION create_workspace_wallet() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO workspace_wallets(workspace_id) VALUES(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER workspace_wallet_create AFTER INSERT ON workspaces FOR EACH ROW EXECUTE FUNCTION create_workspace_wallet();
CREATE FUNCTION billing_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Billing record is immutable' USING ERRCODE='23514'; END $$;
CREATE TABLE price_catalogs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation text NOT NULL CHECK(operation IN('AI_VIDEO','CLIPPER')),
 realm text NOT NULL CHECK(realm IN('TEST','PRODUCTION')), active_version_id uuid, UNIQUE(operation,realm)
);
CREATE TABLE price_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), catalog_id uuid NOT NULL REFERENCES price_catalogs(id), version_number integer NOT NULL CHECK(version_number>0),
 label text NOT NULL, rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='object'), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(catalog_id,version_number), UNIQUE(catalog_id,id)
);
ALTER TABLE price_catalogs ADD FOREIGN KEY(id,active_version_id) REFERENCES price_versions(catalog_id,id);
CREATE TRIGGER price_versions_immutable BEFORE UPDATE OR DELETE ON price_versions FOR EACH ROW EXECUTE FUNCTION billing_immutable();
CREATE TABLE billing_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), created_by uuid NOT NULL REFERENCES users(id),
 operation text NOT NULL CHECK(operation IN('AI_VIDEO','CLIPPER')), price_version_id uuid NOT NULL REFERENCES price_versions(id),
 request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'), input_hash text NOT NULL CHECK(input_hash~'^[a-f0-9]{64}$'),
 input_snapshot jsonb NOT NULL, token_amount bigint NOT NULL CHECK(token_amount>0), quote_hash text NOT NULL CHECK(quote_hash~'^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE TRIGGER quotes_immutable BEFORE UPDATE OR DELETE ON billing_quotes FOR EACH ROW EXECUTE FUNCTION billing_immutable();
CREATE TABLE token_packages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, realm text NOT NULL CHECK(realm IN('TEST','PRODUCTION')),
 active_version_id uuid, UNIQUE(code,realm)
);
CREATE TABLE token_package_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), package_id uuid NOT NULL REFERENCES token_packages(id), version_number integer NOT NULL CHECK(version_number>0),
 label text NOT NULL, token_amount bigint NOT NULL CHECK(token_amount>0), fiat_minor bigint NOT NULL CHECK(fiat_minor>0 AND fiat_minor<=9007199254740991),
 currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(package_id,version_number), UNIQUE(package_id,id)
);
ALTER TABLE token_packages ADD FOREIGN KEY(id,active_version_id) REFERENCES token_package_versions(package_id,id);
CREATE TRIGGER package_versions_immutable BEFORE UPDATE OR DELETE ON token_package_versions FOR EACH ROW EXECUTE FUNCTION billing_immutable();
CREATE TABLE payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), created_by uuid NOT NULL REFERENCES users(id),
 package_version_id uuid NOT NULL REFERENCES token_package_versions(id), token_amount bigint NOT NULL CHECK(token_amount>0),
 fiat_minor bigint NOT NULL CHECK(fiat_minor>0), currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 provider text NOT NULL CHECK(provider IN('fake','xendit')), provider_mode text NOT NULL CHECK(provider_mode IN('TEST','SANDBOX')),
 reference_id text NOT NULL UNIQUE, external_id text, status text NOT NULL DEFAULT 'CREATING' CHECK(status IN('CREATING','PENDING','PAID','FAILED','EXPIRED','REFUNDED')),
 creation_attempted_at timestamptz, creation_unknown boolean NOT NULL DEFAULT false, checkout_url text, expires_at timestamptz,
 request_key text NOT NULL, request_hash text NOT NULL, purchase_ledger_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,request_key), UNIQUE(provider,external_id), UNIQUE(workspace_id,id)
);
CREATE TABLE payment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, event_key text NOT NULL, payload_hash text NOT NULL,
 payment_id uuid REFERENCES payments(id), safe_payload jsonb NOT NULL, disposition text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider,event_key)
);
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION billing_immutable();
-- Provider truth for local simulations is separate from the merchant's payment projection.
CREATE TABLE fake_payment_states (
 external_id text PRIMARY KEY, reference_id text NOT NULL UNIQUE, fiat_minor bigint NOT NULL, currency text NOT NULL,
 status text NOT NULL CHECK(status IN('PENDING','PAID','FAILED','EXPIRED','REFUNDED')), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_reconciliation_issues (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid REFERENCES workspaces(id), issue_key text NOT NULL UNIQUE,
 code text NOT NULL, job_id uuid REFERENCES jobs(id), payment_id uuid REFERENCES payments(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE job_billing (
 job_id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspace_wallets(workspace_id), quote_id uuid NOT NULL UNIQUE,
 price_version_id uuid NOT NULL REFERENCES price_versions(id), token_amount bigint NOT NULL CHECK(token_amount>0),
 status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN('RESERVED','CAPTURED','RELEASED','REFUNDED')),
 reserve_ledger_id uuid, capture_ledger_id uuid, release_ledger_id uuid, refund_ledger_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz, UNIQUE(workspace_id,job_id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id), FOREIGN KEY(workspace_id,quote_id) REFERENCES billing_quotes(workspace_id,id)
);
CREATE TABLE token_ledger_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspace_wallets(workspace_id),
 entry_type text NOT NULL CHECK(entry_type IN('PURCHASE','PROMOTIONAL_GRANT','RESERVE','CAPTURE','RELEASE','REFUND','ADMIN_ADJUSTMENT')),
 available_delta bigint NOT NULL, reserved_delta bigint NOT NULL, job_id uuid, payment_id uuid, quote_id uuid,
 idempotency_key text NOT NULL, operator_id uuid REFERENCES users(id), reason text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,idempotency_key), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES job_billing(workspace_id,job_id),
 FOREIGN KEY(workspace_id,payment_id) REFERENCES payments(workspace_id,id), FOREIGN KEY(workspace_id,quote_id) REFERENCES billing_quotes(workspace_id,id),
 CHECK((entry_type='RESERVE' AND available_delta<0 AND reserved_delta=-available_delta AND job_id IS NOT NULL AND quote_id IS NOT NULL AND payment_id IS NULL)
 OR(entry_type='CAPTURE' AND available_delta=0 AND reserved_delta<0 AND job_id IS NOT NULL AND payment_id IS NULL)
 OR(entry_type='RELEASE' AND available_delta>0 AND reserved_delta=-available_delta AND job_id IS NOT NULL AND payment_id IS NULL)
 OR(entry_type='REFUND' AND available_delta>0 AND reserved_delta=0 AND job_id IS NOT NULL AND operator_id IS NOT NULL AND length(reason)>=5 AND payment_id IS NULL)
 OR(entry_type='PURCHASE' AND available_delta>0 AND reserved_delta=0 AND payment_id IS NOT NULL AND job_id IS NULL)
 OR(entry_type IN('PROMOTIONAL_GRANT','ADMIN_ADJUSTMENT') AND available_delta<>0 AND reserved_delta=0 AND job_id IS NULL AND payment_id IS NULL AND operator_id IS NOT NULL AND length(reason)>=5 AND (entry_type<>'PROMOTIONAL_GRANT' OR available_delta>0)))
);
CREATE UNIQUE INDEX ledger_job_once ON token_ledger_entries(job_id,entry_type) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_purchase_once ON token_ledger_entries(payment_id) WHERE entry_type='PURCHASE';
CREATE INDEX ledger_workspace_history ON token_ledger_entries(workspace_id,created_at DESC,id DESC);
ALTER TABLE payments ADD FOREIGN KEY(workspace_id,purchase_ledger_id) REFERENCES token_ledger_entries(workspace_id,id);
ALTER TABLE job_billing ADD FOREIGN KEY(workspace_id,reserve_ledger_id) REFERENCES token_ledger_entries(workspace_id,id),
 ADD FOREIGN KEY(workspace_id,capture_ledger_id) REFERENCES token_ledger_entries(workspace_id,id),
 ADD FOREIGN KEY(workspace_id,release_ledger_id) REFERENCES token_ledger_entries(workspace_id,id),
 ADD FOREIGN KEY(workspace_id,refund_ledger_id) REFERENCES token_ledger_entries(workspace_id,id);
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON token_ledger_entries FOR EACH ROW EXECUTE FUNCTION billing_immutable();
CREATE FUNCTION apply_token_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b job_billing; p payments; j jobs; q billing_quotes;
BEGIN
 PERFORM 1 FROM workspace_wallets WHERE workspace_id=NEW.workspace_id FOR UPDATE;
 IF NEW.job_id IS NOT NULL THEN
  SELECT * INTO b FROM job_billing WHERE job_id=NEW.job_id AND workspace_id=NEW.workspace_id;
  SELECT * INTO j FROM jobs WHERE id=NEW.job_id;
  IF abs(CASE WHEN NEW.entry_type='CAPTURE' THEN NEW.reserved_delta ELSE NEW.available_delta END)<>b.token_amount THEN RAISE EXCEPTION 'Job amount mismatch'; END IF;
  IF NEW.entry_type='RESERVE' AND (b.status<>'RESERVED' OR NEW.quote_id<>b.quote_id OR j.status<>'QUEUED') THEN RAISE EXCEPTION 'Invalid reservation'; END IF;
  IF NEW.entry_type='CAPTURE' AND (b.status<>'RESERVED' OR j.status<>'SUCCEEDED' OR NOT EXISTS(SELECT 1 FROM content_publications WHERE job_id=j.id) OR NOT EXISTS(SELECT 1 FROM job_artifacts a JOIN job_attempts t ON t.id=a.attempt_id WHERE a.job_id=j.id AND a.status='READY' AND t.status='SUCCEEDED' AND t.attempt_number=j.attempt_count)) THEN RAISE EXCEPTION 'Invalid capture'; END IF;
  IF NEW.entry_type='RELEASE' AND (b.status<>'RESERVED' OR j.status NOT IN('FAILED','CANCELLED') OR EXISTS(SELECT 1 FROM provider_executions WHERE job_id=j.id AND state IN('SUBMITTING','SUBMISSION_UNKNOWN','SUBMITTED','RUNNING','OUTPUT_PENDING'))) THEN RAISE EXCEPTION 'Outcome not definite'; END IF;
  IF NEW.entry_type='REFUND' AND b.status<>'CAPTURED' THEN RAISE EXCEPTION 'Invalid token refund'; END IF;
 END IF;
 IF NEW.entry_type='PURCHASE' THEN
  SELECT * INTO p FROM payments WHERE id=NEW.payment_id AND workspace_id=NEW.workspace_id;
  IF p.status<>'PAID' OR p.token_amount<>NEW.available_delta THEN RAISE EXCEPTION 'Invalid purchase'; END IF;
 END IF;
 UPDATE workspace_wallets SET available_tokens=available_tokens+NEW.available_delta,reserved_tokens=reserved_tokens+NEW.reserved_delta,updated_at=now() WHERE workspace_id=NEW.workspace_id;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_apply AFTER INSERT ON token_ledger_entries FOR EACH ROW EXECUTE FUNCTION apply_token_ledger();
CREATE FUNCTION protect_wallet_projection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND pg_trigger_depth()<2) OR (TG_OP='INSERT' AND (NEW.available_tokens<>0 OR NEW.reserved_tokens<>0)) THEN RAISE EXCEPTION 'Wallet can only change through ledger'; END IF;
 IF TG_OP='UPDATE' AND NEW.workspace_id<>OLD.workspace_id THEN RAISE EXCEPTION 'Wallet identity is immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER wallet_projection_guard BEFORE INSERT OR UPDATE OR DELETE ON workspace_wallets FOR EACH ROW EXECUTE FUNCTION protect_wallet_projection();
ALTER TABLE jobs ADD COLUMN billing_mode text NOT NULL DEFAULT 'LEGACY' CHECK(billing_mode IN('PAID','DIAGNOSTIC','LEGACY'));
ALTER TABLE jobs ALTER COLUMN billing_mode SET DEFAULT 'PAID';
CREATE FUNCTION validate_job_billing() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q billing_quotes; j jobs;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Job billing cannot be deleted'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.job_id,NEW.workspace_id,NEW.quote_id,NEW.price_version_id,NEW.token_amount) IS DISTINCT FROM (OLD.job_id,OLD.workspace_id,OLD.quote_id,OLD.price_version_id,OLD.token_amount) THEN RAISE EXCEPTION 'Job billing identity is immutable'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='RESERVED' AND NEW.status IN('CAPTURED','RELEASED')) OR (OLD.status='CAPTURED' AND NEW.status='REFUNDED')) THEN RAISE EXCEPTION 'Invalid billing transition'; END IF;
 END IF;
 SELECT * INTO q FROM billing_quotes WHERE id=NEW.quote_id; SELECT * INTO j FROM jobs WHERE id=NEW.job_id;
 IF q.workspace_id<>NEW.workspace_id OR q.operation<>j.type OR q.price_version_id<>NEW.price_version_id OR q.token_amount<>NEW.token_amount OR q.input_hash<>j.input_hash OR q.request_hash<>j.client_request_hash THEN RAISE EXCEPTION 'Quote binding mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER job_billing_identity BEFORE INSERT OR UPDATE OR DELETE ON job_billing FOR EACH ROW EXECUTE FUNCTION validate_job_billing();
CREATE FUNCTION require_paid_job_reserve() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.billing_mode='PAID' AND NOT EXISTS(SELECT 1 FROM job_billing b JOIN token_ledger_entries l ON l.id=b.reserve_ledger_id WHERE b.job_id=NEW.id AND l.entry_type='RESERVE' AND l.job_id=b.job_id) THEN RAISE EXCEPTION 'Paid job requires atomic reservation'; END IF;
 IF NEW.type='SYSTEM_TEST' AND NEW.billing_mode<>'DIAGNOSTIC' THEN RAISE EXCEPTION 'System test must be diagnostic'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER paid_job_reserve_required AFTER INSERT ON jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_paid_job_reserve();
CREATE FUNCTION payment_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v token_package_versions;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Payment cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.workspace_id,NEW.created_by,NEW.package_version_id,NEW.token_amount,NEW.fiat_minor,NEW.currency,NEW.provider,NEW.provider_mode,NEW.reference_id,NEW.request_key,NEW.request_hash) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.created_by,OLD.package_version_id,OLD.token_amount,OLD.fiat_minor,OLD.currency,OLD.provider,OLD.provider_mode,OLD.reference_id,OLD.request_key,OLD.request_hash) THEN RAISE EXCEPTION 'Payment identity is immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.external_id IS NOT NULL AND OLD.external_id IS DISTINCT FROM NEW.external_id THEN RAISE EXCEPTION 'External identity is immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD.status IN('PAID','REFUNDED') AND NEW.status<>OLD.status AND NOT(OLD.status='PAID' AND NEW.status='REFUNDED') THEN RAISE EXCEPTION 'Paid payment cannot regress'; END IF;
 SELECT * INTO v FROM token_package_versions WHERE id=NEW.package_version_id;
 IF (NEW.token_amount,NEW.fiat_minor,NEW.currency) IS DISTINCT FROM(v.token_amount,v.fiat_minor,v.currency) THEN RAISE EXCEPTION 'Package mismatch'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER payments_identity BEFORE INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payment_identity_guard();
CREATE FUNCTION billing_references_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b job_billing; p payments;
BEGIN
 IF TG_TABLE_NAME='job_billing' THEN
  SELECT * INTO b FROM job_billing WHERE job_id=NEW.job_id;
  IF b.reserve_ledger_id IS NULL OR NOT EXISTS(SELECT 1 FROM token_ledger_entries WHERE id=b.reserve_ledger_id AND job_id=b.job_id AND entry_type='RESERVE') OR
  (b.status='CAPTURED' AND NOT EXISTS(SELECT 1 FROM token_ledger_entries WHERE id=b.capture_ledger_id AND job_id=b.job_id AND entry_type='CAPTURE')) OR
  (b.status='RELEASED' AND NOT EXISTS(SELECT 1 FROM token_ledger_entries WHERE id=b.release_ledger_id AND job_id=b.job_id AND entry_type='RELEASE')) OR
  (b.status='REFUNDED' AND NOT EXISTS(SELECT 1 FROM token_ledger_entries WHERE id=b.refund_ledger_id AND job_id=b.job_id AND entry_type='REFUND')) THEN RAISE EXCEPTION 'Missing billing ledger reference'; END IF;
 ELSE
  SELECT * INTO p FROM payments WHERE id=NEW.id;
  IF p.status IN('PAID','REFUNDED') AND NOT EXISTS(SELECT 1 FROM token_ledger_entries WHERE id=p.purchase_ledger_id AND payment_id=p.id AND entry_type='PURCHASE') THEN RAISE EXCEPTION 'Paid payment requires atomic purchase'; END IF;
 END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER billing_ledger_required AFTER INSERT OR UPDATE ON job_billing DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing_references_required();
CREATE CONSTRAINT TRIGGER payment_purchase_required AFTER INSERT OR UPDATE ON payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing_references_required();
CREATE FUNCTION billing_catalog_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Catalog identity cannot be deleted'; END IF;
 IF to_jsonb(NEW)-'active_version_id' IS DISTINCT FROM to_jsonb(OLD)-'active_version_id' THEN RAISE EXCEPTION 'Catalog identity is immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER price_catalog_identity BEFORE UPDATE OR DELETE ON price_catalogs FOR EACH ROW EXECUTE FUNCTION billing_catalog_identity();
CREATE TRIGGER token_package_identity BEFORE UPDATE OR DELETE ON token_packages FOR EACH ROW EXECUTE FUNCTION billing_catalog_identity();
CREATE FUNCTION billing_quote_validate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM price_versions v JOIN price_catalogs c ON c.id=v.catalog_id WHERE v.id=NEW.price_version_id AND c.operation=NEW.operation) OR octet_length(NEW.input_snapshot::text)>262144 THEN RAISE EXCEPTION 'Invalid quote price or snapshot'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER quote_validate BEFORE INSERT ON billing_quotes FOR EACH ROW EXECUTE FUNCTION billing_quote_validate();
CREATE FUNCTION job_billing_mode_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.billing_mode<>OLD.billing_mode THEN RAISE EXCEPTION 'Job billing mode is immutable'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER jobs_billing_mode_immutable BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION job_billing_mode_immutable();
CREATE FUNCTION billing_ledger_refs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (OLD.reserve_ledger_id IS NOT NULL AND NEW.reserve_ledger_id IS DISTINCT FROM OLD.reserve_ledger_id) OR
 (OLD.capture_ledger_id IS NOT NULL AND NEW.capture_ledger_id IS DISTINCT FROM OLD.capture_ledger_id) OR
 (OLD.release_ledger_id IS NOT NULL AND NEW.release_ledger_id IS DISTINCT FROM OLD.release_ledger_id) OR
 (OLD.refund_ledger_id IS NOT NULL AND NEW.refund_ledger_id IS DISTINCT FROM OLD.refund_ledger_id) THEN RAISE EXCEPTION 'Ledger references cannot regress'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER billing_refs_immutable BEFORE UPDATE ON job_billing FOR EACH ROW EXECUTE FUNCTION billing_ledger_refs_immutable();
