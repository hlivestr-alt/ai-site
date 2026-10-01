-- Controlled orchestration over jobs, billing and Content. No second execution queue.
CREATE TABLE workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  current_version_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE(workspace_id,id)
);
CREATE TABLE workflow_definition_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  workflow_definition_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number>0),
  template_key text NOT NULL CHECK (template_key IN ('PRODUCT_AI_VIDEO_REVIEW_V1','SOURCE_CLIPPER_REVIEW_V1')),
  template_version integer NOT NULL CHECK (template_version=1),
  configuration jsonb NOT NULL CHECK (jsonb_typeof(configuration)='object' AND octet_length(configuration::text)<=16384),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,workflow_definition_id) REFERENCES workflow_definitions(workspace_id,id),
  UNIQUE(workflow_definition_id,version_number),
  UNIQUE(workspace_id,workflow_definition_id,id)
);
ALTER TABLE workflow_definitions ADD FOREIGN KEY(workspace_id,id,current_version_id)
  REFERENCES workflow_definition_versions(workspace_id,workflow_definition_id,id);
CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  definition_version_id uuid NOT NULL,
  template_key text NOT NULL CHECK (template_key IN ('PRODUCT_AI_VIDEO_REVIEW_V1','SOURCE_CLIPPER_REVIEW_V1')),
  template_version integer NOT NULL CHECK (template_version=1),
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','WAITING_FOR_FUNDS','WAITING_FOR_REVIEW','PAUSED','SUCCEEDED','FAILED','CANCELLED')),
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot)='object' AND octet_length(input_snapshot::text)<=524288),
  max_tokens bigint NOT NULL CHECK (max_tokens BETWEEN 1 AND 9007199254740991),
  tokens_committed bigint NOT NULL DEFAULT 0 CHECK (tokens_committed>=0 AND tokens_committed<=max_tokens),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 160),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb CHECK (result IS NULL OR (jsonb_typeof(result)='object' AND octet_length(result::text)<=32768)),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  paused_at timestamptz,
  finished_at timestamptz,
  cancel_requested_at timestamptz,
  next_reconcile_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  failure_code text CHECK (length(failure_code)<=80),
  failure_message_safe text CHECK (length(failure_message_safe)<=240),
  FOREIGN KEY(workspace_id,definition_id,definition_version_id) REFERENCES workflow_definition_versions(workspace_id,workflow_definition_id,id),
  UNIQUE(workspace_id,request_key),
  UNIQUE(workspace_id,id)
);
CREATE INDEX workflow_runs_due ON workflow_runs(next_reconcile_at,id) WHERE status NOT IN ('SUCCEEDED','FAILED','CANCELLED');
CREATE INDEX workflow_runs_history ON workflow_runs(workspace_id,created_at DESC,id DESC);
CREATE TABLE workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  workflow_run_id uuid NOT NULL,
  step_key text NOT NULL CHECK (length(step_key) BETWEEN 1 AND 100),
  step_type text NOT NULL CHECK (step_type IN ('INPUT','SCRIPT_INPUT','AI_VIDEO','CLIPPER','REVIEW_GATE','COMPLETE')),
  parent_step_id uuid,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 100),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','READY','RUNNING','WAITING','SUCCEEDED','FAILED','SKIPPED','CANCELLED')),
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_snapshot)='object' AND octet_length(input_snapshot::text)<=65536),
  output_snapshot jsonb CHECK (output_snapshot IS NULL OR (jsonb_typeof(output_snapshot)='object' AND octet_length(output_snapshot::text)<=32768)),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  FOREIGN KEY(workspace_id,workflow_run_id) REFERENCES workflow_runs(workspace_id,id),
  UNIQUE(workflow_run_id,step_key),
  UNIQUE(workspace_id,workflow_run_id,id),
  FOREIGN KEY(workspace_id,workflow_run_id,parent_step_id) REFERENCES workflow_steps(workspace_id,workflow_run_id,id)
);
ALTER TABLE jobs ADD COLUMN workflow_run_id uuid, ADD COLUMN workflow_step_id uuid;
ALTER TABLE jobs ADD CHECK ((workflow_run_id IS NULL)=(workflow_step_id IS NULL));
ALTER TABLE jobs ADD FOREIGN KEY(workspace_id,workflow_run_id,workflow_step_id) REFERENCES workflow_steps(workspace_id,workflow_run_id,id);
ALTER TABLE jobs ADD UNIQUE(workspace_id,workflow_run_id,workflow_step_id,id);
CREATE UNIQUE INDEX jobs_one_workflow_child ON jobs(workspace_id,workflow_run_id,workflow_step_id) WHERE workflow_run_id IS NOT NULL;
CREATE TABLE workflow_child_jobs (
  workspace_id uuid NOT NULL,
  workflow_run_id uuid NOT NULL,
  workflow_step_id uuid NOT NULL,
  job_id uuid NOT NULL UNIQUE,
  child_key text NOT NULL CHECK (length(child_key) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workflow_run_id,child_key),
  UNIQUE(workflow_step_id),
  FOREIGN KEY(workspace_id,workflow_run_id,workflow_step_id,job_id) REFERENCES jobs(workspace_id,workflow_run_id,workflow_step_id,id)
);
CREATE TABLE workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  workflow_run_id uuid NOT NULL,
  workflow_step_id uuid,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 3 AND 80),
  safe_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_data)='object' AND octet_length(safe_data::text)<=4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,workflow_run_id) REFERENCES workflow_runs(workspace_id,id),
  FOREIGN KEY(workspace_id,workflow_run_id,workflow_step_id) REFERENCES workflow_steps(workspace_id,workflow_run_id,id)
);
CREATE INDEX workflow_events_history ON workflow_events(workspace_id,workflow_run_id,created_at,id);
ALTER TABLE content_versions ADD COLUMN workflow_run_id uuid, ADD COLUMN workflow_step_id uuid;
ALTER TABLE content_versions ADD CHECK ((workflow_run_id IS NULL)=(workflow_step_id IS NULL));
ALTER TABLE content_versions ADD FOREIGN KEY(workspace_id,workflow_run_id,workflow_step_id,job_id) REFERENCES jobs(workspace_id,workflow_run_id,workflow_step_id,id);
ALTER TABLE content_versions ADD UNIQUE(workspace_id,workflow_run_id,workflow_step_id,content_item_id,id);
-- Exact, immutable review bindings. These contain IDs, never object keys or URLs.
CREATE TABLE workflow_review_bindings (
  workspace_id uuid NOT NULL,
  workflow_run_id uuid NOT NULL,
  review_step_id uuid NOT NULL,
  producer_step_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  content_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workflow_run_id,content_version_id),
  FOREIGN KEY(workspace_id,workflow_run_id,review_step_id) REFERENCES workflow_steps(workspace_id,workflow_run_id,id),
  FOREIGN KEY(workspace_id,workflow_run_id,producer_step_id,content_item_id,content_version_id) REFERENCES content_versions(workspace_id,workflow_run_id,workflow_step_id,content_item_id,id)
);
CREATE FUNCTION workflow_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Workflow history is immutable'; END $$;
CREATE TRIGGER workflow_versions_immutable BEFORE UPDATE OR DELETE ON workflow_definition_versions FOR EACH ROW EXECUTE FUNCTION workflow_immutable_row();
CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON workflow_events FOR EACH ROW EXECUTE FUNCTION workflow_immutable_row();
CREATE TRIGGER workflow_children_immutable BEFORE UPDATE OR DELETE ON workflow_child_jobs FOR EACH ROW EXECUTE FUNCTION workflow_immutable_row();
CREATE TRIGGER workflow_reviews_immutable BEFORE UPDATE OR DELETE ON workflow_review_bindings FOR EACH ROW EXECUTE FUNCTION workflow_immutable_row();
CREATE FUNCTION workflow_guard_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Workflow run history is retained'; END IF;
  IF (NEW.id,NEW.workspace_id,NEW.definition_id,NEW.definition_version_id,NEW.template_key,NEW.template_version,NEW.input_snapshot,NEW.request_key,NEW.request_hash,NEW.created_by,NEW.created_at)
     IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.definition_id,OLD.definition_version_id,OLD.template_key,OLD.template_version,OLD.input_snapshot,OLD.request_key,OLD.request_hash,OLD.created_by,OLD.created_at)
     OR NEW.max_tokens<OLD.max_tokens THEN RAISE EXCEPTION 'Workflow input is immutable; budget may only increase'; END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED','CANCELLED') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal workflow is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_runs_guard BEFORE UPDATE OR DELETE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION workflow_guard_run();
CREATE FUNCTION workflow_guard_step() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Workflow step history is retained'; END IF;
  IF (NEW.id,NEW.workspace_id,NEW.workflow_run_id,NEW.step_key,NEW.step_type,NEW.parent_step_id,NEW.ordinal,NEW.input_snapshot,NEW.created_at)
     IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.workflow_run_id,OLD.step_key,OLD.step_type,OLD.parent_step_id,OLD.ordinal,OLD.input_snapshot,OLD.created_at)
     THEN RAISE EXCEPTION 'Workflow step input is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_steps_guard BEFORE UPDATE OR DELETE ON workflow_steps FOR EACH ROW EXECUTE FUNCTION workflow_guard_step();
CREATE FUNCTION workflow_guard_job_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.workflow_run_id,NEW.workflow_step_id) IS DISTINCT FROM (OLD.workflow_run_id,OLD.workflow_step_id)
    THEN RAISE EXCEPTION 'Job workflow lineage is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_workflow_lineage_immutable BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION workflow_guard_job_lineage();
CREATE FUNCTION workflow_content_lineage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r uuid; s uuid;
BEGIN
  SELECT workflow_run_id,workflow_step_id INTO r,s FROM jobs WHERE workspace_id=NEW.workspace_id AND id=NEW.job_id;
  IF (NEW.workflow_run_id IS NOT NULL OR NEW.workflow_step_id IS NOT NULL) AND
     (NEW.workflow_run_id,NEW.workflow_step_id) IS DISTINCT FROM (r,s) THEN RAISE EXCEPTION 'Content workflow lineage differs from Job'; END IF;
  NEW.workflow_run_id:=r; NEW.workflow_step_id:=s;
  RETURN NEW;
END $$;
CREATE TRIGGER content_versions_workflow_lineage BEFORE INSERT ON content_versions FOR EACH ROW EXECUTE FUNCTION workflow_content_lineage();
