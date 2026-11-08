-- P0 KeyPackage claim/replay: one stable client intent returns the exact same claimed packages.
-- Results are retained durably so a lost HTTP response cannot burn one-time KeyPackages.
CREATE TABLE IF NOT EXISTS mls_key_package_claims (
  target_user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  requester_user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  requester_device_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  result JSONB,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (target_user_id, requester_user_id, requester_device_id, claim_id)
);
CREATE INDEX IF NOT EXISTS mls_key_package_claims_created
  ON mls_key_package_claims (created_at);
