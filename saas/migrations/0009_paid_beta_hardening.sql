-- Operational controls over existing authority; no new processing queue or ledger.
CREATE TABLE workspace_limits (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 limit_name text NOT NULL CHECK(limit_name IN('active_jobs','active_workflows','queued_ai_videos','queued_clipper_jobs','source_uploads_daily','storage_bytes','product_assets')),
 limit_value bigint NOT NULL CHECK(limit_value BETWEEN 1 AND 9007199254740991),
 updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,limit_name)
);
CREATE TABLE service_heartbeats (
 service text NOT NULL CHECK(service IN('execution_dispatcher','workflow_dispatcher')), instance_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN('STARTING','RUNNING','ERROR','STOPPED')),
 started_at timestamptz NOT NULL DEFAULT now(), last_tick_at timestamptz NOT NULL DEFAULT now(), last_success_at timestamptz,
 stopped_at timestamptz, error_code text CHECK(length(error_code)<=80),
 subservices jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(subservices)='object' AND octet_length(subservices::text)<=8192),
 PRIMARY KEY(service,instance_id)
);
CREATE INDEX service_heartbeats_fresh ON service_heartbeats(service,last_tick_at DESC);
CREATE TABLE storage_object_observations (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), storage_key text NOT NULL CHECK(length(storage_key) BETWEEN 1 AND 1024),
 byte_size bigint NOT NULL CHECK(byte_size>=0), last_checked_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,storage_key), CHECK(storage_key LIKE 'workspaces/'||workspace_id::text||'/%' OR storage_key LIKE 'pending/workspaces/'||workspace_id::text||'/%')
);
CREATE TABLE backup_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), completed_at timestamptz NOT NULL DEFAULT now(),
 migration_version text NOT NULL, dump_sha256 text NOT NULL CHECK(dump_sha256 ~ '^[a-f0-9]{64}$'),
 object_count integer NOT NULL CHECK(object_count>=0), object_bytes bigint NOT NULL CHECK(object_bytes>=0),
 manifest_name text NOT NULL CHECK(length(manifest_name)<=200), restore_verified_at timestamptz
);
CREATE TABLE mail_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient text NOT NULL CHECK(length(recipient)<=254),
 subject text NOT NULL CHECK(length(subject)<=200), encrypted_payload text NOT NULL CHECK(length(encrypted_payload)<=8192),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','SENDING','SENT','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), last_error_code text CHECK(length(last_error_code)<=80),
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE INDEX mail_deliveries_due ON mail_deliveries(available_at,id) WHERE status IN('PENDING','SENDING');
CREATE VIEW workspace_storage_objects AS
 SELECT DISTINCT ON(workspace_id,storage_key) workspace_id,object_id,category,storage_key,byte_size,sha256,mime_type FROM (
 SELECT workspace_id,id AS object_id,'product_asset'::text AS category,storage_key,byte_size,sha256,mime_type FROM asset_versions WHERE status='READY'
 UNION ALL SELECT a.workspace_id,a.id,'product_thumbnail',a.thumbnail_key,o.byte_size,NULL,'image/jpeg' FROM asset_versions a LEFT JOIN storage_object_observations o ON o.workspace_id=a.workspace_id AND o.storage_key=a.thumbnail_key WHERE a.status='READY' AND a.thumbnail_key IS NOT NULL
 UNION ALL SELECT workspace_id,id,'source',storage_key,byte_size,sha256,mime_type FROM source_assets WHERE status IN('UPLOADED','VERIFIED','ARCHIVED')
 UNION ALL SELECT workspace_id,id,'job_artifact',storage_key,byte_size,sha256,mime_type FROM job_artifacts WHERE status='READY'
 UNION ALL SELECT workspace_id,content_version_id,'poster',storage_key,byte_size,sha256,mime_type FROM content_posters WHERE status='READY'
 ) refs ORDER BY workspace_id,storage_key,byte_size DESC NULLS LAST;
