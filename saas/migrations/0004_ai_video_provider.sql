-- Phase 4 raises the video staging ceiling without relaxing diagnostic artifacts.
ALTER TABLE job_artifacts DROP CONSTRAINT job_artifacts_expected_byte_size_check;
ALTER TABLE job_artifacts ADD CONSTRAINT job_artifacts_expected_byte_size_check
  CHECK (expected_byte_size BETWEEN 1 AND 536870912);
ALTER TABLE job_artifacts ADD CONSTRAINT job_artifacts_mime_size_check
  CHECK (mime_type='video/mp4' OR expected_byte_size<=20971520);
ALTER TABLE job_artifacts ADD COLUMN duration_seconds numeric(8,2);
ALTER TABLE job_artifacts ADD COLUMN width integer;
ALTER TABLE job_artifacts ADD COLUMN height integer;

ALTER TABLE jobs ADD COLUMN client_request_hash text CHECK (client_request_hash IS NULL OR client_request_hash ~ '^[a-f0-9]{64}$');
CREATE FUNCTION prevent_job_request_hash_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.client_request_hash IS DISTINCT FROM OLD.client_request_hash THEN
    RAISE EXCEPTION 'Job request identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_request_hash_immutable BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION prevent_job_request_hash_mutation();

CREATE TABLE provider_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_tier text NOT NULL CHECK (customer_tier IN ('FAST','QUALITY','PREMIUM')),
  provider text NOT NULL CHECK (provider IN ('BYTEPLUS')),
  model text NOT NULL,
  policy_version text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  min_duration_seconds integer NOT NULL CHECK (min_duration_seconds>=1),
  max_duration_seconds integer NOT NULL CHECK (max_duration_seconds>=min_duration_seconds),
  aspect_ratios jsonb NOT NULL CHECK (jsonb_typeof(aspect_ratios)='array'),
  max_reference_images integer NOT NULL CHECK (max_reference_images BETWEEN 0 AND 30),
  max_quantity integer NOT NULL CHECK (max_quantity BETWEEN 1 AND 4),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX provider_configurations_one_enabled_tier ON provider_configurations(customer_tier) WHERE enabled;
INSERT INTO provider_configurations(customer_tier,provider,model,policy_version,enabled,min_duration_seconds,max_duration_seconds,aspect_ratios,max_reference_images,max_quantity)
VALUES('QUALITY','BYTEPLUS','dreamina-seedance-2-5-260628','seedance25-2026-09-28',true,4,30,'["9:16","16:9","1:1"]'::jsonb,4,1);

CREATE TABLE provider_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number>0),
  provider text NOT NULL CHECK (provider IN ('BYTEPLUS','FAKE')),
  model text NOT NULL,
  provider_policy_version text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  submission_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  state text NOT NULL DEFAULT 'RESERVED' CHECK (state IN ('RESERVED','SUBMITTING','SUBMISSION_UNKNOWN','SUBMITTED','RUNNING','OUTPUT_PENDING','SUCCEEDED','FAILED','CANCELLED')),
  external_task_id text,
  submit_count integer NOT NULL DEFAULT 0 CHECK (submit_count>=0),
  poll_count integer NOT NULL DEFAULT 0 CHECK (poll_count>=0),
  ingest_count integer NOT NULL DEFAULT 0 CHECK (ingest_count>=0),
  next_action_at timestamptz NOT NULL DEFAULT now(),
  submission_started_at timestamptz,
  submitted_at timestamptz,
  last_polled_at timestamptz,
  completed_at timestamptz,
  provider_error_code text,
  safe_error text,
  usage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(usage_metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,job_id,attempt_id) REFERENCES job_attempts(workspace_id,job_id,id),
  UNIQUE(job_id,attempt_number),
  UNIQUE(provider,external_task_id)
);
CREATE INDEX provider_executions_due ON provider_executions(next_action_at,created_at)
  WHERE state IN ('RESERVED','SUBMITTING','SUBMISSION_UNKNOWN','SUBMITTED','RUNNING','OUTPUT_PENDING');
CREATE INDEX provider_executions_workspace_job ON provider_executions(workspace_id,job_id,attempt_number DESC);
