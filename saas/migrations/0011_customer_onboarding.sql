-- Link encrypted delivery tasks to expiring, single-use authentication state.
ALTER TABLE mail_deliveries ADD COLUMN auth_token_id uuid REFERENCES auth_tokens(id);
CREATE INDEX mail_deliveries_auth_token ON mail_deliveries(auth_token_id) WHERE auth_token_id IS NOT NULL;
