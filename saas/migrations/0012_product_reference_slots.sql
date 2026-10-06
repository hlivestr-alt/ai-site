-- Add current selection pointers without altering immutable media or job snapshots.
ALTER TABLE products ADD COLUMN cover_asset_id uuid;
ALTER TABLE products ADD CONSTRAINT products_cover_asset_fk FOREIGN KEY(workspace_id,id,cover_asset_id) REFERENCES assets(workspace_id,product_id,id);
CREATE TABLE product_reference_slots (
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  slot text NOT NULL CHECK(slot IN('FRONT','BACK','SIDE','PACKAGING','CAP_PUMP','TEXTURE','REAL_USAGE','ADDITIONAL')),
  asset_id uuid,
  PRIMARY KEY(workspace_id,product_id,slot),
  FOREIGN KEY(workspace_id,product_id) REFERENCES products(workspace_id,id),
  FOREIGN KEY(workspace_id,product_id,asset_id) REFERENCES assets(workspace_id,product_id,id)
);
INSERT INTO product_reference_slots(workspace_id,product_id,slot,asset_id)
SELECT DISTINCT ON(workspace_id,product_id,slot) workspace_id,product_id,slot,id FROM (
 SELECT a.*,CASE WHEN purpose IN('LEFT_SIDE','RIGHT_SIDE') THEN 'SIDE' WHEN purpose IN('USAGE_IMAGE','USAGE_VIDEO') THEN 'REAL_USAGE' WHEN purpose IN('PRODUCT_VIDEO','OTHER') THEN 'ADDITIONAL' ELSE purpose END AS slot
 FROM assets a JOIN asset_versions v ON v.id=a.current_version_id AND v.workspace_id=a.workspace_id AND v.asset_id=a.id AND v.product_id=a.product_id
 WHERE a.status='READY' AND v.status='READY'
) ready ORDER BY workspace_id,product_id,slot,updated_at DESC,id DESC;
ALTER TABLE asset_versions ADD COLUMN reference_slot text CHECK(reference_slot IN('FRONT','BACK','SIDE','PACKAGING','CAP_PUMP','TEXTURE','REAL_USAGE','ADDITIONAL'));
CREATE UNIQUE INDEX asset_versions_pending_slot ON asset_versions(workspace_id,product_id,reference_slot) WHERE status='PENDING_UPLOAD' AND reference_slot IS NOT NULL;
