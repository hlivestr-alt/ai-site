-- No seller credentials or authorization codes are stored in the router.
CREATE TABLE outreach_oauth_router_states (
 state_hash text PRIMARY KEY CHECK(state_hash ~ '^[a-f0-9]{64}$'),
 flow_kind text NOT NULL CHECK(flow_kind IN ('SAAS','NATIVE')),
 operation_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,
 workspace_id uuid,channel_id uuid,actor_id uuid REFERENCES users(id),session_id uuid REFERENCES sessions(id),
 saas_state_hash text UNIQUE REFERENCES outreach_oauth_states(state_hash),
 native_issuer text,native_browser_hash text,completion_identity text,ticket_hash text,
 browser_hash text,bound_at timestamptz,integrity_mac text NOT NULL CHECK(integrity_mac ~ '^[a-f0-9]{64}$'),
 FOREIGN KEY(workspace_id,channel_id) REFERENCES outreach_channels(workspace_id,id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
 CHECK(consumed_at IS NULL OR consumed_at>=created_at),
 CHECK((flow_kind='SAAS' AND workspace_id IS NOT NULL AND channel_id IS NOT NULL AND actor_id IS NOT NULL AND session_id IS NOT NULL AND saas_state_hash IS NOT NULL AND saas_state_hash=state_hash AND native_issuer IS NULL AND native_browser_hash IS NULL AND completion_identity IS NULL AND ticket_hash IS NULL AND browser_hash IS NULL AND bound_at IS NULL)
 OR (flow_kind='NATIVE' AND workspace_id IS NULL AND channel_id IS NULL AND actor_id IS NULL AND session_id IS NULL AND saas_state_hash IS NULL AND native_issuer IS NOT NULL AND native_issuer='NATIVE_OPERATOR_V1' AND native_browser_hash IS NOT NULL AND native_browser_hash ~ '^[a-f0-9]{64}$' AND completion_identity IS NOT NULL AND completion_identity='NATIVE_PRIVATE_V1' AND ticket_hash IS NOT NULL AND ticket_hash ~ '^[a-f0-9]{64}$' AND ((browser_hash IS NULL AND bound_at IS NULL) OR (browser_hash IS NOT NULL AND browser_hash ~ '^[a-f0-9]{64}$' AND bound_at IS NOT NULL))))
);
CREATE INDEX outreach_oauth_router_expiry ON outreach_oauth_router_states(expires_at);
CREATE TABLE outreach_oauth_handoff_nonces (
 nonce_hash text PRIMARY KEY CHECK(nonce_hash ~ '^[a-f0-9]{64}$'),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
