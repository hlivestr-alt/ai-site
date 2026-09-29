CREATE SEQUENCE job_fencing_token_seq AS bigint;

CREATE TABLE workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 100),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DRAINING','DISABLED')),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(capabilities)='array'),
  agent_version text NOT NULL DEFAULT '',
  pipeline_version text NOT NULL DEFAULT '',
  max_concurrency integer NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 16),
  available_slots integer NOT NULL DEFAULT 0 CHECK (available_slots BETWEEN 0 AND 16),
  last_heartbeat_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE INDEX workers_heartbeat ON workers(last_heartbeat_at DESC) WHERE status<>'DISABLED';

CREATE TABLE worker_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id uuid NOT NULL REFERENCES workers(id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX worker_credentials_active ON worker_credentials(worker_id) WHERE revoked_at IS NULL;

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  type text NOT NULL CHECK (type IN ('SYSTEM_TEST','AI_VIDEO','CLIPPER','SCRIPT','THUMBNAIL','WORKFLOW_CHILD')),
  required_capability text NOT NULL CHECK (length(required_capability) BETWEEN 2 AND 80),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','WAITING_FOR_WORKER','RUNNING','RECONCILING','SUCCEEDED','FAILED','CANCELLED')),
  product_id uuid,
  product_version_id uuid,
  product_rule_version_id uuid,
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot)='object'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 160),
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  progress_stage text NOT NULL DEFAULT 'queued' CHECK (length(progress_stage)<=80),
  progress_message text NOT NULL DEFAULT '' CHECK (length(progress_message)<=240),
  progress_sequence integer NOT NULL DEFAULT 0 CHECK (progress_sequence>=0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  cancel_requested_at timestamptz,
  cancelled_at timestamptz,
  error_code text CHECK (error_code IS NULL OR length(error_code)<=80),
  error_message_safe text CHECK (error_message_safe IS NULL OR length(error_message_safe)<=240),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id),
  FOREIGN KEY(workspace_id,product_id,product_version_id) REFERENCES product_versions(workspace_id,product_id,id),
  FOREIGN KEY(workspace_id,product_id,product_rule_version_id) REFERENCES product_accuracy_rule_versions(workspace_id,product_id,id),
  UNIQUE(workspace_id,type,idempotency_key),
  UNIQUE(workspace_id,id)
);
CREATE INDEX jobs_workspace_recent ON jobs(workspace_id,created_at DESC,id DESC);
CREATE INDEX jobs_workspace_status ON jobs(workspace_id,status,created_at DESC);
CREATE INDEX jobs_claimable ON jobs(required_capability,available_at,created_at) WHERE status='WAITING_FOR_WORKER';

CREATE FUNCTION prevent_job_input_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.type IS DISTINCT FROM OLD.type OR
     NEW.required_capability IS DISTINCT FROM OLD.required_capability OR NEW.product_id IS DISTINCT FROM OLD.product_id OR
     NEW.product_version_id IS DISTINCT FROM OLD.product_version_id OR NEW.product_rule_version_id IS DISTINCT FROM OLD.product_rule_version_id OR
     NEW.input_snapshot IS DISTINCT FROM OLD.input_snapshot OR NEW.input_hash IS DISTINCT FROM OLD.input_hash OR
     NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Job input is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_input_immutable BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION prevent_job_input_mutation();

CREATE TABLE job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number>0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','LOST','CANCELLED')),
  worker_id uuid REFERENCES workers(id),
  progress_sequence integer NOT NULL DEFAULT 0 CHECK (progress_sequence>=0),
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message_safe text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),
  UNIQUE(job_id,attempt_number),
  UNIQUE(workspace_id,job_id,id)
);
CREATE INDEX job_attempts_recent ON job_attempts(workspace_id,job_id,attempt_number DESC);

CREATE TABLE job_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  kind text NOT NULL DEFAULT 'DISPATCH' CHECK (kind='DISPATCH'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSED','CANCELLED')),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),
  UNIQUE(job_id,attempt_number)
);
CREATE INDEX job_outbox_pending ON job_outbox(available_at,created_at) WHERE status='PENDING';

CREATE TABLE worker_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  worker_id uuid NOT NULL REFERENCES workers(id),
  fencing_token bigint NOT NULL DEFAULT nextval('job_fencing_token_seq'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','FAILED','EXPIRED','CANCELLED')),
  expires_at timestamptz NOT NULL,
  renewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  FOREIGN KEY(workspace_id,job_id,attempt_id) REFERENCES job_attempts(workspace_id,job_id,id),
  UNIQUE(attempt_id),
  UNIQUE(fencing_token)
);
CREATE UNIQUE INDEX worker_leases_one_active_job ON worker_leases(job_id) WHERE status='ACTIVE';
CREATE INDEX worker_leases_expiry ON worker_leases(expires_at) WHERE status='ACTIVE';
CREATE INDEX worker_leases_worker_active ON worker_leases(worker_id) WHERE status='ACTIVE';

CREATE TABLE job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_id uuid,
  worker_id uuid,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 3 AND 80),
  safe_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_data)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),
  FOREIGN KEY(workspace_id,job_id,attempt_id) REFERENCES job_attempts(workspace_id,job_id,id),
  FOREIGN KEY(worker_id) REFERENCES workers(id)
);
CREATE INDEX job_events_recent ON job_events(workspace_id,job_id,created_at DESC,id DESC);

CREATE TABLE job_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  slot_name text NOT NULL CHECK (length(slot_name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','READY','FAILED')),
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  expected_byte_size bigint NOT NULL CHECK (expected_byte_size BETWEEN 1 AND 20971520),
  expected_sha256 text CHECK (expected_sha256 IS NULL OR expected_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  FOREIGN KEY(workspace_id,job_id,attempt_id) REFERENCES job_attempts(workspace_id,job_id,id),
  UNIQUE(attempt_id,slot_name)
);
CREATE INDEX job_artifacts_job ON job_artifacts(workspace_id,job_id,attempt_id);
