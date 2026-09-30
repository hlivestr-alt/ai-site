-- Metadata over existing immutable private artifacts; no duplicate video storage.
CREATE TABLE content_publications (
  workspace_id uuid NOT NULL,
  job_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text CHECK (length(last_error_code)<=80),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id)
);
CREATE INDEX content_publications_pending ON content_publications(available_at,job_id) WHERE status='PENDING';
CREATE FUNCTION enqueue_content_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='SUCCEEDED' AND NEW.type IN ('AI_VIDEO','CLIPPER') THEN
    INSERT INTO content_publications(workspace_id,job_id) VALUES(NEW.workspace_id,NEW.id) ON CONFLICT(job_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_content_publication AFTER INSERT OR UPDATE OF status ON jobs FOR EACH ROW EXECUTE FUNCTION enqueue_content_publication();
INSERT INTO content_publications(workspace_id,job_id) SELECT workspace_id,id FROM jobs WHERE status='SUCCEEDED' AND type IN ('AI_VIDEO','CLIPPER');

CREATE TABLE content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  type text NOT NULL CHECK (type IN ('AI_VIDEO','CLIP')),
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','APPROVED','REJECTED','ARCHIVED')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 320),
  product_name text CHECK (length(product_name)<=160),
  source_filename text CHECK (length(source_filename)<=200),
  current_version_id uuid,
  product_id uuid,
  source_asset_id uuid,
  origin_job_id uuid NOT NULL,
  review_revision integer NOT NULL DEFAULT 0 CHECK (review_revision>=0),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id),
  FOREIGN KEY(workspace_id,source_asset_id) REFERENCES source_assets(workspace_id,id),
  FOREIGN KEY(workspace_id,origin_job_id) REFERENCES jobs(workspace_id,id),
  UNIQUE(workspace_id,id)
);
CREATE INDEX content_items_library ON content_items(workspace_id,created_at DESC,id DESC);
CREATE INDEX content_items_review ON content_items(workspace_id,status,created_at DESC,id DESC);
CREATE TABLE content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number>0),
  artifact_id uuid NOT NULL,
  job_id uuid NOT NULL,
  mime_type text NOT NULL CHECK (mime_type='video/mp4'),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 536870912),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  duration_seconds double precision CHECK (duration_seconds>0 AND duration_seconds<86400),
  width integer CHECK (width BETWEEN 1 AND 16384),
  height integer CHECK (height BETWEEN 1 AND 16384),
  product_id uuid,
  product_version_id uuid,
  product_rule_version_id uuid,
  source_asset_id uuid,
  transcript_artifact_id uuid,
  plan_artifact_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object' AND octet_length(metadata::text)<=32768),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,content_item_id) REFERENCES content_items(workspace_id,id),
  FOREIGN KEY(workspace_id,job_id,artifact_id) REFERENCES job_artifacts(workspace_id,job_id,id),
  FOREIGN KEY(workspace_id,job_id,transcript_artifact_id) REFERENCES job_artifacts(workspace_id,job_id,id),
  FOREIGN KEY(workspace_id,job_id,plan_artifact_id) REFERENCES job_artifacts(workspace_id,job_id,id),
  FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id),
  FOREIGN KEY(workspace_id,product_id,product_version_id) REFERENCES product_versions(workspace_id,product_id,id),
  FOREIGN KEY(workspace_id,product_id,product_rule_version_id) REFERENCES product_accuracy_rule_versions(workspace_id,product_id,id),
  FOREIGN KEY(workspace_id,source_asset_id) REFERENCES source_assets(workspace_id,id),
  CHECK ((product_id IS NULL AND product_version_id IS NULL AND product_rule_version_id IS NULL) OR
         (product_id IS NOT NULL AND product_version_id IS NOT NULL AND product_rule_version_id IS NOT NULL)),
  UNIQUE(content_item_id,version_number),
  UNIQUE(workspace_id,artifact_id),
  UNIQUE(workspace_id,content_item_id,id)
);
ALTER TABLE content_items ADD CONSTRAINT content_current_version_fk FOREIGN KEY(workspace_id,id,current_version_id) REFERENCES content_versions(workspace_id,content_item_id,id);

-- Keeps exact historical references and prevents cleanup of those AssetVersions.
CREATE TABLE content_reference_assets (
  workspace_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  content_version_id uuid NOT NULL,
  product_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  asset_version_id uuid NOT NULL,
  purpose text NOT NULL,
  PRIMARY KEY(content_version_id,asset_version_id),
  FOREIGN KEY(workspace_id,content_item_id,content_version_id) REFERENCES content_versions(workspace_id,content_item_id,id),
  FOREIGN KEY(workspace_id,product_id,asset_id,asset_version_id) REFERENCES asset_versions(workspace_id,product_id,asset_id,id)
);
CREATE TABLE content_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('GENERATED_FROM','CLIPPED_FROM','VARIANT_OF')),
  parent_content_id uuid,
  source_asset_id uuid,
  job_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,content_item_id) REFERENCES content_items(workspace_id,id),
  FOREIGN KEY(workspace_id,parent_content_id) REFERENCES content_items(workspace_id,id),
  FOREIGN KEY(workspace_id,source_asset_id) REFERENCES source_assets(workspace_id,id),
  FOREIGN KEY(workspace_id,job_id) REFERENCES jobs(workspace_id,id),
  CHECK (parent_content_id IS DISTINCT FROM content_item_id),
  CHECK ((relation_type='VARIANT_OF' AND parent_content_id IS NOT NULL AND source_asset_id IS NULL AND job_id IS NULL) OR
         (relation_type='CLIPPED_FROM' AND source_asset_id IS NOT NULL AND parent_content_id IS NULL AND job_id IS NULL) OR
         (relation_type='GENERATED_FROM' AND job_id IS NOT NULL AND parent_content_id IS NULL AND source_asset_id IS NULL))
);
CREATE UNIQUE INDEX content_variant_unique ON content_relations(workspace_id,content_item_id,parent_content_id) WHERE relation_type='VARIANT_OF';
CREATE UNIQUE INDEX content_variant_one_parent ON content_relations(workspace_id,content_item_id) WHERE relation_type='VARIANT_OF';
CREATE UNIQUE INDEX content_source_relation_unique ON content_relations(workspace_id,content_item_id,source_asset_id) WHERE relation_type='CLIPPED_FROM';
CREATE UNIQUE INDEX content_job_relation_unique ON content_relations(workspace_id,content_item_id,job_id) WHERE relation_type='GENERATED_FROM';
CREATE INDEX content_variant_parents ON content_relations(workspace_id,parent_content_id) WHERE relation_type='VARIANT_OF';
CREATE FUNCTION guard_content_variant_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cyclic boolean; deepest integer;
BEGIN
  IF NEW.relation_type='VARIANT_OF' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text,6));
    WITH RECURSIVE ancestors(id,depth) AS (
      SELECT NEW.parent_content_id,0 UNION ALL
      SELECT r.parent_content_id,a.depth+1 FROM ancestors a JOIN content_relations r ON r.content_item_id=a.id
      WHERE r.workspace_id=NEW.workspace_id AND r.relation_type='VARIANT_OF' AND a.depth<64
    ) SELECT coalesce(bool_or(id=NEW.content_item_id),false),max(depth) INTO cyclic,deepest FROM ancestors;
    IF cyclic OR deepest>=64 THEN RAISE EXCEPTION 'Variant cycle or traversal limit' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_variant_acyclic BEFORE INSERT ON content_relations FOR EACH ROW EXECUTE FUNCTION guard_content_variant_cycle();

CREATE TABLE review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  content_version_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK (decision IN ('APPROVE','REJECT')),
  reason_category text CHECK (reason_category IN ('LOGO_WRONG','PACKAGING_TEXT_WRONG','PRODUCT_SHAPE_WRONG','CAP_PUMP_WRONG','COLOR_MATERIAL_WRONG','APPLICATION_METHOD_WRONG','QUALITY_ISSUE','BAD_CLIP_SELECTION','CAPTION_ISSUE','OTHER')),
  reason_text text CHECK (length(reason_text)<=1000),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 160),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  review_revision integer NOT NULL CHECK (review_revision>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,content_item_id,content_version_id) REFERENCES content_versions(workspace_id,content_item_id,id),
  CHECK ((decision='APPROVE' AND reason_category IS NULL AND reason_text IS NULL) OR (decision='REJECT' AND reason_category IS NOT NULL)),
  UNIQUE(workspace_id,content_item_id,request_key),
  UNIQUE(content_item_id,review_revision)
);
CREATE INDEX review_decisions_history ON review_decisions(workspace_id,content_item_id,review_revision DESC);

-- Poster failure is independent from publication and review state.
CREATE TABLE content_posters (
  workspace_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  content_version_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','READY','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  storage_key text UNIQUE,
  mime_type text CHECK (mime_type='image/jpeg'),
  byte_size integer CHECK (byte_size BETWEEN 1 AND 1048576),
  sha256 text CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  last_error_code text CHECK (length(last_error_code)<=80),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,content_item_id,content_version_id) REFERENCES content_versions(workspace_id,content_item_id,id),
  CHECK (status<>'READY' OR (storage_key IS NOT NULL AND mime_type IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL))
);
CREATE FUNCTION content_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Content history is immutable'; END $$;
CREATE TRIGGER content_versions_immutable BEFORE UPDATE OR DELETE ON content_versions FOR EACH ROW EXECUTE FUNCTION content_append_only();
CREATE TRIGGER review_decisions_append_only BEFORE UPDATE OR DELETE ON review_decisions FOR EACH ROW EXECUTE FUNCTION content_append_only();
CREATE TRIGGER content_relations_append_only BEFORE UPDATE OR DELETE ON content_relations FOR EACH ROW EXECUTE FUNCTION content_append_only();
CREATE TRIGGER content_reference_assets_immutable BEFORE UPDATE OR DELETE ON content_reference_assets FOR EACH ROW EXECUTE FUNCTION content_append_only();
CREATE TRIGGER content_items_no_delete BEFORE DELETE ON content_items FOR EACH ROW EXECUTE FUNCTION content_append_only();
CREATE FUNCTION guard_content_item_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.type IS DISTINCT FROM OLD.type OR
     NEW.origin_job_id IS DISTINCT FROM OLD.origin_job_id OR NEW.product_id IS DISTINCT FROM OLD.product_id OR
     NEW.source_asset_id IS DISTINCT FROM OLD.source_asset_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Content origin is immutable';
  END IF;
  IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN NEW.status='PENDING_REVIEW'; NEW.review_revision=OLD.review_revision+1; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_items_identity BEFORE UPDATE ON content_items FOR EACH ROW EXECUTE FUNCTION guard_content_item_identity();
CREATE FUNCTION validate_content_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a job_artifacts; j jobs; i content_items;
BEGIN
  SELECT * INTO a FROM job_artifacts WHERE workspace_id=NEW.workspace_id AND job_id=NEW.job_id AND id=NEW.artifact_id;
  SELECT * INTO j FROM jobs WHERE workspace_id=NEW.workspace_id AND id=NEW.job_id;
  SELECT * INTO i FROM content_items WHERE workspace_id=NEW.workspace_id AND id=NEW.content_item_id;
  IF a.id IS NULL OR j.status IS DISTINCT FROM 'SUCCEEDED' OR a.status IS DISTINCT FROM 'READY' OR a.mime_type<>'video/mp4' OR
     NOT coalesce(j.result->'artifactIds' ? a.id::text,false) OR NOT EXISTS (SELECT 1 FROM job_attempts t WHERE t.id=a.attempt_id AND t.job_id=j.id AND t.status='SUCCEEDED' AND t.attempt_number=j.attempt_count) OR
     NEW.sha256 IS DISTINCT FROM a.sha256 OR NEW.byte_size IS DISTINCT FROM a.byte_size OR NEW.mime_type IS DISTINCT FROM a.mime_type OR
     NEW.duration_seconds IS DISTINCT FROM a.duration_seconds OR NEW.width IS DISTINCT FROM a.width OR NEW.height IS DISTINCT FROM a.height OR
     NEW.product_id IS DISTINCT FROM j.product_id OR NEW.product_version_id IS DISTINCT FROM j.product_version_id OR NEW.product_rule_version_id IS DISTINCT FROM j.product_rule_version_id OR
     (NEW.version_number=1 AND i.origin_job_id IS DISTINCT FROM j.id) OR i.type IS DISTINCT FROM (CASE WHEN j.type='AI_VIDEO' THEN 'AI_VIDEO' ELSE 'CLIP' END) OR
     i.product_id IS DISTINCT FROM NEW.product_id OR i.source_asset_id IS DISTINCT FROM NEW.source_asset_id THEN
    RAISE EXCEPTION 'Content must match a successful authoritative artifact' USING ERRCODE='23514';
  END IF;
  IF j.type='CLIPPER' AND (NEW.source_asset_id::text IS DISTINCT FROM j.input_snapshot->'source'->>'sourceAssetId' OR
      NEW.transcript_artifact_id::text IS DISTINCT FROM j.result->>'transcriptArtifactId' OR NEW.plan_artifact_id::text IS DISTINCT FROM j.result->>'planArtifactId' OR
      NOT EXISTS (SELECT 1 FROM jsonb_array_elements(j.result->'clips') c WHERE c->>'artifactId'=NEW.artifact_id::text)) THEN
    RAISE EXCEPTION 'Clip lineage mismatch' USING ERRCODE='23514';
  END IF;
  IF j.type NOT IN ('AI_VIDEO','CLIPPER') THEN RAISE EXCEPTION 'Unsupported content origin'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_versions_validate BEFORE INSERT ON content_versions FOR EACH ROW EXECUTE FUNCTION validate_content_version();
CREATE FUNCTION retain_published_artifact_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM content_versions v WHERE v.artifact_id=OLD.id OR v.transcript_artifact_id=OLD.id OR v.plan_artifact_id=OLD.id) AND
     (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR
      NEW.storage_key IS DISTINCT FROM OLD.storage_key OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.byte_size IS DISTINCT FROM OLD.byte_size OR
      NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.status IS DISTINCT FROM OLD.status OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds OR
      NEW.width IS DISTINCT FROM OLD.width OR NEW.height IS DISTINCT FROM OLD.height) THEN RAISE EXCEPTION 'Published artifact is retained and immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER job_artifacts_content_retention BEFORE UPDATE ON job_artifacts FOR EACH ROW EXECUTE FUNCTION retain_published_artifact_identity();
CREATE FUNCTION require_content_current_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM content_items WHERE id=NEW.id AND current_version_id IS NULL) THEN RAISE EXCEPTION 'Content needs a current version'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER content_current_version_required AFTER INSERT OR UPDATE ON content_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_content_current_version();
CREATE FUNCTION validate_content_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM content_versions v JOIN jobs j ON j.id=v.job_id AND j.workspace_id=v.workspace_id
    WHERE v.workspace_id=NEW.workspace_id AND v.content_item_id=NEW.content_item_id AND v.id=NEW.content_version_id AND v.product_id=NEW.product_id
    AND j.type='AI_VIDEO' AND j.input_snapshot->'referenceAssetVersionIds' ? NEW.asset_version_id::text) THEN
    RAISE EXCEPTION 'Reference was not used by this content version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_reference_validate BEFORE INSERT ON content_reference_assets FOR EACH ROW EXECUTE FUNCTION validate_content_reference();
