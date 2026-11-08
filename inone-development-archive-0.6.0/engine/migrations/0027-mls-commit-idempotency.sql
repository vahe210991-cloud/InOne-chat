-- A membership commit retry must resolve to the exact accepted epoch.
CREATE TABLE IF NOT EXISTS mls_commit_operations (
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  client_operation_id TEXT NOT NULL CHECK (client_operation_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  request_fingerprint CHAR(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  resulting_epoch BIGINT NOT NULL CHECK (resulting_epoch >= 1),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, sender_id, device_id, client_operation_id)
);
CREATE INDEX IF NOT EXISTS mls_commit_operations_created
  ON mls_commit_operations (created_at);
