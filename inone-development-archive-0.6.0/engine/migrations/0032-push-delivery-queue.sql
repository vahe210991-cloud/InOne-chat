-- Durable push outbox. This queue is intentionally separate from email_deliveries.
ALTER TABLE push_tokens ALTER COLUMN token DROP NOT NULL;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS token_ciphertext BYTEA;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS token_iv BYTEA;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS token_tag BYTEA;
ALTER TABLE push_tokens ADD COLUMN IF NOT EXISTS identifier_kind TEXT NOT NULL DEFAULT 'legacy'
  CHECK (identifier_kind IN ('fid', 'legacy'));

CREATE TABLE IF NOT EXISTS push_deliveries (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key CHAR(64) NOT NULL UNIQUE,
  device_key TEXT NOT NULL REFERENCES devices (device_key) ON DELETE CASCADE,
  payload_ciphertext BYTEA NOT NULL,
  payload_iv BYTEA NOT NULL,
  payload_tag BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'failed', 'provider_accepted', 'dead', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  CHECK ((status = 'processing') = (locked_at IS NOT NULL AND locked_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS push_deliveries_ready
  ON push_deliveries (available_at, id)
  WHERE status IN ('queued', 'failed');
CREATE INDEX IF NOT EXISTS push_deliveries_stale
  ON push_deliveries (locked_at, id)
  WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS push_deliveries_device
  ON push_deliveries (device_key, status, id);
