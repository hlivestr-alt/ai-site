-- Additive visual variations. Existing content, jobs, artifacts and ledger rows are untouched.
ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK(type IN('SYSTEM_TEST','AI_VIDEO','CLIPPER','CLIPPER_VARIATION','SCRIPT','THUMBNAIL','WORKFLOW_CHILD'));
ALTER TABLE price_catalogs DROP CONSTRAINT price_catalogs_operation_check;
ALTER TABLE price_catalogs ADD CONSTRAINT price_catalogs_operation_check CHECK(operation IN('AI_VIDEO','CLIPPER','CLIPPER_VARIATION'));
ALTER TABLE billing_quotes DROP CONSTRAINT billing_quotes_operation_check;
ALTER TABLE billing_quotes ADD CONSTRAINT billing_quotes_operation_check CHECK(operation IN('AI_VIDEO','CLIPPER','CLIPPER_VARIATION'));

CREATE TABLE clipper_variations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
 source_content_id uuid NOT NULL, source_version_id uuid NOT NULL, source_artifact_id uuid NOT NULL,
 root_content_id uuid NOT NULL, root_version_id uuid NOT NULL, root_artifact_id uuid NOT NULL, root_job_id uuid NOT NULL,
 parent_variation_id uuid, variation_number integer NOT NULL CHECK(variation_number BETWEEN 1 AND 10000),
 settings_snapshot jsonb NOT NULL CHECK(jsonb_typeof(settings_snapshot)='object' AND octet_length(settings_snapshot::text)<=8192),
 settings_hash text NOT NULL CHECK(settings_hash ~ '^[a-f0-9]{64}$'),
 render_job_id uuid NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 result_content_id uuid, result_version_id uuid, result_artifact_id uuid,
 UNIQUE(workspace_id,id), UNIQUE(root_version_id,variation_number),
 FOREIGN KEY(workspace_id,source_content_id,source_version_id) REFERENCES content_versions(workspace_id,content_item_id,id),
 FOREIGN KEY(workspace_id,root_content_id,root_version_id) REFERENCES content_versions(workspace_id,content_item_id,id),
 FOREIGN KEY(workspace_id,root_job_id) REFERENCES jobs(workspace_id,id),
 FOREIGN KEY(workspace_id,render_job_id) REFERENCES jobs(workspace_id,id),
 FOREIGN KEY(workspace_id,parent_variation_id) REFERENCES clipper_variations(workspace_id,id),
 FOREIGN KEY(workspace_id,result_content_id,result_version_id) REFERENCES content_versions(workspace_id,content_item_id,id),
 CHECK((result_content_id IS NULL AND result_version_id IS NULL AND result_artifact_id IS NULL) OR
       (result_content_id IS NOT NULL AND result_version_id IS NOT NULL AND result_artifact_id IS NOT NULL))
);
CREATE INDEX clipper_variations_history ON clipper_variations(workspace_id,root_version_id,variation_number);
CREATE FUNCTION guard_clipper_variation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j jobs; r content_versions; s content_versions; p clipper_variations;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Variation lineage is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'result_content_id'-'result_version_id'-'result_artifact_id') IS DISTINCT FROM
     (to_jsonb(OLD)-'result_content_id'-'result_version_id'-'result_artifact_id') THEN RAISE EXCEPTION 'Variation input is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.result_content_id IS NOT NULL AND
   (NEW.result_content_id,NEW.result_version_id,NEW.result_artifact_id) IS DISTINCT FROM
   (OLD.result_content_id,OLD.result_version_id,OLD.result_artifact_id) THEN RAISE EXCEPTION 'Variation publication is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO j FROM jobs WHERE workspace_id=NEW.workspace_id AND id=NEW.render_job_id;
 SELECT * INTO r FROM content_versions WHERE workspace_id=NEW.workspace_id AND content_item_id=NEW.root_content_id AND id=NEW.root_version_id;
 SELECT * INTO s FROM content_versions WHERE workspace_id=NEW.workspace_id AND content_item_id=NEW.source_content_id AND id=NEW.source_version_id;
 IF j.id IS NULL OR j.type<>'CLIPPER_VARIATION' OR j.input_snapshot->>'kind'<>'CLIPPER_VARIATION' OR j.created_by<>NEW.created_by OR
    r.artifact_id IS DISTINCT FROM NEW.root_artifact_id OR r.job_id IS DISTINCT FROM NEW.root_job_id OR s.artifact_id IS DISTINCT FROM NEW.source_artifact_id OR
    NOT EXISTS(SELECT 1 FROM jobs WHERE id=r.job_id AND workspace_id=NEW.workspace_id AND type='CLIPPER' AND status='SUCCEEDED') OR
    j.input_snapshot->'settings' IS DISTINCT FROM NEW.settings_snapshot OR j.input_snapshot->>'settingsHash' IS DISTINCT FROM NEW.settings_hash OR
    j.input_snapshot->'lineage'->>'sourceArtifactId' IS DISTINCT FROM NEW.source_artifact_id::text OR
    j.input_snapshot->'lineage'->>'rootArtifactId' IS DISTINCT FROM NEW.root_artifact_id::text OR
    j.input_snapshot->'lineage'->>'sourceContentId' IS DISTINCT FROM NEW.source_content_id::text OR
    j.input_snapshot->'lineage'->>'sourceVersionId' IS DISTINCT FROM NEW.source_version_id::text OR
    j.input_snapshot->'lineage'->>'rootContentId' IS DISTINCT FROM NEW.root_content_id::text OR
    j.input_snapshot->'lineage'->>'rootVersionId' IS DISTINCT FROM NEW.root_version_id::text OR
    j.input_snapshot->'lineage'->>'rootJobId' IS DISTINCT FROM NEW.root_job_id::text OR
    j.input_snapshot->'lineage'->>'parentVariationId' IS DISTINCT FROM NEW.parent_variation_id::text THEN
    RAISE EXCEPTION 'Variation lineage must match frozen workspace input' USING ERRCODE='23514';
 END IF;
 IF NEW.parent_variation_id IS NOT NULL THEN
   SELECT * INTO p FROM clipper_variations WHERE workspace_id=NEW.workspace_id AND id=NEW.parent_variation_id;
   IF p.result_content_id IS DISTINCT FROM NEW.source_content_id OR p.result_version_id IS DISTINCT FROM NEW.source_version_id OR p.root_version_id<>NEW.root_version_id THEN
     RAISE EXCEPTION 'Variation parent differs from source' USING ERRCODE='23514'; END IF;
 ELSIF NEW.source_version_id<>NEW.root_version_id THEN RAISE EXCEPTION 'Original variation source differs' USING ERRCODE='23514'; END IF;
 IF NEW.result_content_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM content_versions v WHERE v.workspace_id=NEW.workspace_id AND
   v.content_item_id=NEW.result_content_id AND v.id=NEW.result_version_id AND v.job_id=NEW.render_job_id AND v.artifact_id=NEW.result_artifact_id) THEN
   RAISE EXCEPTION 'Variation result must be authoritative Content' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clipper_variations_identity BEFORE INSERT OR UPDATE OR DELETE ON clipper_variations FOR EACH ROW EXECUTE FUNCTION guard_clipper_variation();
CREATE FUNCTION require_variation_lineage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.type='CLIPPER_VARIATION' AND NOT EXISTS(SELECT 1 FROM clipper_variations WHERE render_job_id=NEW.id AND workspace_id=NEW.workspace_id) THEN
   RAISE EXCEPTION 'Variation job requires atomic lineage' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER variation_lineage_required AFTER INSERT ON jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_variation_lineage();

CREATE OR REPLACE FUNCTION enqueue_content_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='SUCCEEDED' AND NEW.type IN('AI_VIDEO','CLIPPER','CLIPPER_VARIATION') THEN
   INSERT INTO content_publications(workspace_id,job_id) VALUES(NEW.workspace_id,NEW.id) ON CONFLICT(job_id) DO NOTHING;
 END IF; RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION validate_content_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a job_artifacts; j jobs; i content_items;
BEGIN
 SELECT * INTO a FROM job_artifacts WHERE workspace_id=NEW.workspace_id AND job_id=NEW.job_id AND id=NEW.artifact_id;
 SELECT * INTO j FROM jobs WHERE workspace_id=NEW.workspace_id AND id=NEW.job_id;
 SELECT * INTO i FROM content_items WHERE workspace_id=NEW.workspace_id AND id=NEW.content_item_id;
 IF a.id IS NULL OR j.status IS DISTINCT FROM 'SUCCEEDED' OR a.status IS DISTINCT FROM 'READY' OR a.mime_type<>'video/mp4' OR
    NOT coalesce(j.result->'artifactIds' ? a.id::text,false) OR NOT EXISTS(SELECT 1 FROM job_attempts t WHERE t.id=a.attempt_id AND t.job_id=j.id AND t.status='SUCCEEDED' AND t.attempt_number=j.attempt_count) OR
    NEW.sha256 IS DISTINCT FROM a.sha256 OR NEW.byte_size IS DISTINCT FROM a.byte_size OR NEW.mime_type IS DISTINCT FROM a.mime_type OR
    NEW.duration_seconds IS DISTINCT FROM a.duration_seconds OR NEW.width IS DISTINCT FROM a.width OR NEW.height IS DISTINCT FROM a.height OR
    NEW.product_id IS DISTINCT FROM j.product_id OR NEW.product_version_id IS DISTINCT FROM j.product_version_id OR NEW.product_rule_version_id IS DISTINCT FROM j.product_rule_version_id OR
    (NEW.version_number=1 AND i.origin_job_id IS DISTINCT FROM j.id) OR i.type IS DISTINCT FROM (CASE WHEN j.type='AI_VIDEO' THEN 'AI_VIDEO' ELSE 'CLIP' END) OR
    i.product_id IS DISTINCT FROM NEW.product_id OR i.source_asset_id IS DISTINCT FROM NEW.source_asset_id THEN
   RAISE EXCEPTION 'Content must match a successful authoritative artifact' USING ERRCODE='23514'; END IF;
 IF j.type IN('CLIPPER','CLIPPER_VARIATION') AND (NEW.source_asset_id::text IS DISTINCT FROM j.input_snapshot->'source'->>'sourceAssetId' OR
    NEW.transcript_artifact_id::text IS DISTINCT FROM j.result->>'transcriptArtifactId' OR NEW.plan_artifact_id::text IS DISTINCT FROM j.result->>'planArtifactId' OR
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.result->'clips') c WHERE c->>'artifactId'=NEW.artifact_id::text)) THEN
   RAISE EXCEPTION 'Clip lineage mismatch' USING ERRCODE='23514'; END IF;
 IF j.type NOT IN('AI_VIDEO','CLIPPER','CLIPPER_VARIATION') THEN RAISE EXCEPTION 'Unsupported content origin'; END IF;
 RETURN NEW;
END $$;

-- Configurable, immutable price versions. Internal-beta value, not final commercial pricing.
DO $$ DECLARE realm_name text; catalog uuid; version uuid; BEGIN
 FOREACH realm_name IN ARRAY ARRAY['TEST','PRODUCTION'] LOOP
   INSERT INTO price_catalogs(operation,realm) VALUES('CLIPPER_VARIATION',realm_name) RETURNING id INTO catalog;
   INSERT INTO price_versions(catalog_id,version_number,label,rules) VALUES(catalog,1,CASE WHEN realm_name='TEST' THEN 'TEST INTERNAL BETA visual variation (not final pricing)' ELSE 'INTERNAL BETA visual variation (not final pricing)' END,
     '{"policyVersion":"clipper-visual-variation-v1","approval":"INTERNAL_BETA","perRender":"100","maxDurationSeconds":90}') RETURNING id INTO version;
   UPDATE price_catalogs SET active_version_id=version WHERE id=catalog;
 END LOOP;
END $$;
