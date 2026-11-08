ALTER TABLE mls_key_package_claims
  ADD COLUMN IF NOT EXISTS room_id TEXT REFERENCES rooms (room_id) ON DELETE CASCADE;
ALTER TABLE mls_key_package_claims
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'reserved'
  CHECK (state IN ('reserved', 'committed', 'released'));
ALTER TABLE mls_key_package_claims
  ADD COLUMN IF NOT EXISTS committed_at BIGINT;
ALTER TABLE mls_key_package_claims
  ADD COLUMN IF NOT EXISTS released_at BIGINT;
CREATE INDEX IF NOT EXISTS mls_key_package_claims_room_state
  ON mls_key_package_claims (room_id, state);
