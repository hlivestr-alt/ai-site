-- Nullable markers preserve existing immutable source identities and history.
-- Legacy sources are probed on future paid admission, never blindly backfilled.
ALTER TABLE source_assets ADD COLUMN media_validation_version integer;
ALTER TABLE source_assets ADD COLUMN media_validated_at timestamptz;
ALTER TABLE source_assets ADD COLUMN media_validated_etag text;
ALTER TABLE source_assets ADD COLUMN failure_code text;
ALTER TABLE source_assets ADD COLUMN failed_at timestamptz;
ALTER TABLE asset_versions ADD COLUMN failed_at timestamptz;
ALTER TABLE source_assets ADD COLUMN failed_staging_cleaned_at timestamptz;
ALTER TABLE asset_versions ADD COLUMN failed_staging_cleaned_at timestamptz;
ALTER TABLE source_assets ADD CONSTRAINT source_media_validation CHECK (media_validation_version IS NULL OR media_validation_version = 1);
