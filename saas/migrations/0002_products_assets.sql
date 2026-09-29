CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  sku text CHECK (sku IS NULL OR (length(sku) BETWEEN 1 AND 80 AND sku=trim(sku))),
  current_version_id uuid,
  current_rule_version_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE(workspace_id,id)
);
CREATE UNIQUE INDEX products_active_sku ON products(workspace_id,sku) WHERE status='ACTIVE' AND sku IS NOT NULL;
CREATE INDEX products_workspace_status_updated ON products(workspace_id,status,updated_at DESC,id DESC);

CREATE TABLE product_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number>0),
  brand text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  sku text,
  description text NOT NULL DEFAULT '',
  key_selling_points jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(key_selling_points)='array'),
  target_audience text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id),
  UNIQUE(product_id,version_number),
  UNIQUE(workspace_id,product_id,id)
);
CREATE INDEX product_versions_history ON product_versions(workspace_id,product_id,version_number DESC);
ALTER TABLE products ADD CONSTRAINT products_current_version_fk FOREIGN KEY(workspace_id,id,current_version_id) REFERENCES product_versions(workspace_id,product_id,id);

CREATE TABLE product_accuracy_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number>0),
  keep_logo boolean NOT NULL DEFAULT true,
  keep_packaging_text boolean NOT NULL DEFAULT true,
  keep_product_shape boolean NOT NULL DEFAULT true,
  keep_cap_pump boolean NOT NULL DEFAULT true,
  keep_product_color_material boolean NOT NULL DEFAULT true,
  keep_application_method boolean NOT NULL DEFAULT true,
  custom_instructions text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id),
  UNIQUE(product_id,version_number),
  UNIQUE(workspace_id,product_id,id)
);
CREATE INDEX product_rule_history ON product_accuracy_rule_versions(workspace_id,product_id,version_number DESC);
ALTER TABLE products ADD CONSTRAINT products_current_rule_fk FOREIGN KEY(workspace_id,id,current_rule_version_id) REFERENCES product_accuracy_rule_versions(workspace_id,product_id,id);

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('IMAGE','VIDEO')),
  purpose text NOT NULL CHECK (purpose IN ('FRONT','BACK','LEFT_SIDE','RIGHT_SIDE','PACKAGING','CAP_PUMP','TEXTURE','USAGE_IMAGE','USAGE_VIDEO','PRODUCT_VIDEO','OTHER')),
  status text NOT NULL CHECK (status IN ('PENDING_UPLOAD','READY','FAILED','ARCHIVED')),
  current_version_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id),
  UNIQUE(workspace_id,product_id,id)
);
CREATE INDEX assets_product_status ON assets(workspace_id,product_id,status,created_at DESC);

CREATE TABLE asset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number>0),
  status text NOT NULL CHECK (status IN ('PENDING_UPLOAD','READY','FAILED')),
  storage_key text NOT NULL UNIQUE,
  upload_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  expected_byte_size bigint NOT NULL CHECK (expected_byte_size>0),
  expected_sha256 text CHECK (expected_sha256 IS NULL OR expected_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size>0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  width integer CHECK (width IS NULL OR width>0),
  height integer CHECK (height IS NULL OR height>0),
  duration_seconds numeric(12,3) CHECK (duration_seconds IS NULL OR duration_seconds>=0),
  thumbnail_key text,
  source_type text NOT NULL CHECK (source_type IN ('CUSTOMER_UPLOAD','CUSTOMER_OWNED','LICENSED','CREATOR_AUTHORIZED','OTHER')),
  permission_note text NOT NULL DEFAULT '',
  permission_confirmed_at timestamptz,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  failure_code text,
  FOREIGN KEY(workspace_id,product_id,asset_id) REFERENCES assets(workspace_id,product_id,id),
  UNIQUE(asset_id,version_number),
  UNIQUE(workspace_id,product_id,asset_id,id)
);
CREATE INDEX asset_versions_pending ON asset_versions(created_at) WHERE status='PENDING_UPLOAD';
ALTER TABLE assets ADD CONSTRAINT assets_current_version_fk FOREIGN KEY(workspace_id,product_id,id,current_version_id) REFERENCES asset_versions(workspace_id,product_id,asset_id,id);

CREATE FUNCTION prevent_product_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Product snapshots are immutable';
END $$;
CREATE TRIGGER product_versions_immutable BEFORE UPDATE OR DELETE ON product_versions FOR EACH ROW EXECUTE FUNCTION prevent_product_snapshot_mutation();
CREATE TRIGGER product_rules_immutable BEFORE UPDATE OR DELETE ON product_accuracy_rule_versions FOR EACH ROW EXECUTE FUNCTION prevent_product_snapshot_mutation();

CREATE FUNCTION prevent_owner_reassignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id<>OLD.workspace_id THEN RAISE EXCEPTION 'Workspace ownership is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_workspace_immutable BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION prevent_owner_reassignment();
CREATE TRIGGER assets_workspace_immutable BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION prevent_owner_reassignment();

CREATE FUNCTION prevent_ready_asset_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='READY' THEN RAISE EXCEPTION 'Ready asset versions are immutable'; END IF;
  IF NEW.workspace_id<>OLD.workspace_id OR NEW.product_id<>OLD.product_id OR NEW.asset_id<>OLD.asset_id OR NEW.storage_key<>OLD.storage_key OR NEW.upload_key<>OLD.upload_key THEN
    RAISE EXCEPTION 'Asset version ownership and keys are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER asset_versions_locked BEFORE UPDATE ON asset_versions FOR EACH ROW EXECUTE FUNCTION prevent_ready_asset_version_mutation();
