-- Immutable customer VODs are separate from Product reference assets.
CREATE TABLE source_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  status text NOT NULL DEFAULT 'PENDING_UPLOAD' CHECK (status IN ('PENDING_UPLOAD','UPLOADED','VERIFIED','FAILED','ARCHIVED')),
  original_filename text NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 200),
  mime_type text NOT NULL CHECK (mime_type='video/mp4'),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 107374182400),
  storage_key text NOT NULL UNIQUE,
  upload_key text NOT NULL UNIQUE,
  multipart_upload_id text,
  part_size integer NOT NULL DEFAULT 67108864,
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  duration_seconds double precision CHECK (duration_seconds>0 AND duration_seconds<86400),
  width integer CHECK (width BETWEEN 1 AND 16384),
  height integer CHECK (height BETWEEN 1 AND 16384),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  verified_at timestamptz,
  UNIQUE(workspace_id,id)
);
CREATE INDEX source_assets_workspace ON source_assets(workspace_id,created_at DESC);
CREATE FUNCTION prevent_source_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
     NEW.storage_key IS DISTINCT FROM OLD.storage_key OR NEW.upload_key IS DISTINCT FROM OLD.upload_key OR
     NEW.byte_size IS DISTINCT FROM OLD.byte_size OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR
     NEW.original_filename IS DISTINCT FROM OLD.original_filename OR NEW.created_by IS DISTINCT FROM OLD.created_by OR
     (OLD.sha256 IS NOT NULL AND NEW.sha256 IS DISTINCT FROM OLD.sha256) OR
     (OLD.finalized_at IS NOT NULL AND NEW.finalized_at IS DISTINCT FROM OLD.finalized_at) OR
     (OLD.status<>'PENDING_UPLOAD' AND NEW.status='PENDING_UPLOAD') THEN
    RAISE EXCEPTION 'Source identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_assets_immutable BEFORE UPDATE ON source_assets FOR EACH ROW EXECUTE FUNCTION prevent_source_identity_mutation();

ALTER TABLE job_artifacts DROP CONSTRAINT job_artifacts_mime_size_check;
ALTER TABLE job_artifacts ADD CONSTRAINT job_artifacts_mime_size_check CHECK (
  mime_type='video/mp4' OR
  (mime_type='application/json' AND slot_name='transcript' AND expected_byte_size<=67108864) OR
  expected_byte_size<=20971520
);
ALTER TABLE workers ADD COLUMN clipper_health jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(clipper_health)='object');
ALTER TABLE job_artifacts ADD CONSTRAINT job_artifacts_workspace_job_id UNIQUE(workspace_id,job_id,id);
CREATE TABLE clipper_checkpoints (
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('TRANSCRIPT_READY','PLAN_READY','OUTPUTS_READY')),
  slot_name text NOT NULL,
  artifact_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,slot_name),
  FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),
  FOREIGN KEY(workspace_id,job_id,artifact_id) REFERENCES job_artifacts(workspace_id,job_id,id)
);
