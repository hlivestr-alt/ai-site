-- Independent policies preserve the BytePlus policy and all frozen job identities.
ALTER TABLE provider_configurations DROP CONSTRAINT provider_configurations_provider_check;
ALTER TABLE provider_configurations ADD CONSTRAINT provider_configurations_provider_check
  CHECK (provider IN ('BYTEPLUS','WAVESPEED'));
ALTER TABLE provider_executions DROP CONSTRAINT provider_executions_provider_check;
ALTER TABLE provider_executions ADD CONSTRAINT provider_executions_provider_check
  CHECK (provider IN ('BYTEPLUS','WAVESPEED','FAKE'));
DROP INDEX provider_configurations_one_enabled_tier;
CREATE UNIQUE INDEX provider_configurations_one_enabled_tier_provider
  ON provider_configurations(customer_tier,provider) WHERE enabled;
INSERT INTO provider_configurations(customer_tier,provider,model,policy_version,enabled,min_duration_seconds,max_duration_seconds,aspect_ratios,max_reference_images,max_quantity)
VALUES('QUALITY','WAVESPEED','bytedance/seedance-2.5/text-to-video','wavespeed-seedance25-2026-10-03',true,4,30,'["9:16","16:9","1:1"]'::jsonb,4,1);
