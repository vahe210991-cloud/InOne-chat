-- Bound and rate-limited first-login identity challenges after account recovery.
ALTER TABLE recovery
  ADD COLUMN IF NOT EXISTS identity_code_expires_at BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS identity_device_id TEXT,
  ADD COLUMN IF NOT EXISTS identity_challenge_id TEXT,
  ADD COLUMN IF NOT EXISTS identity_locked_until BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS identity_last_sent_at BIGINT NOT NULL DEFAULT 0;
