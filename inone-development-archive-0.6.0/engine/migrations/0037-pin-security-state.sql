-- Durable PIN verification, reminder and purpose-bound reset state.
ALTER TABLE pins
  ADD COLUMN IF NOT EXISTS last_verified_at BIGINT,
  ADD COLUMN IF NOT EXISTS reminder_next_at BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS pin_reset_challenges (
  user_id TEXT PRIMARY KEY REFERENCES accounts (user_id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  locked_until BIGINT NOT NULL DEFAULT 0,
  last_sent_at BIGINT NOT NULL DEFAULT 0,
  consumed_at BIGINT,
  CHECK (expires_at >= created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX IF NOT EXISTS pin_reset_challenges_expiry_idx
  ON pin_reset_challenges (expires_at)
  WHERE consumed_at IS NULL;
