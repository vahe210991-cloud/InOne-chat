-- Durable, encrypted email delivery queue. Recipient and message content are encrypted together.
CREATE TABLE IF NOT EXISTS email_deliveries (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key CHAR(64) NOT NULL UNIQUE,
  payload_fingerprint CHAR(64) NOT NULL,
  payload_ciphertext BYTEA NOT NULL,
  payload_iv BYTEA NOT NULL,
  payload_tag BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sent', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  CHECK ((status = 'processing') = (locked_at IS NOT NULL AND locked_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS email_deliveries_ready
  ON email_deliveries (available_at, id)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS email_deliveries_stale
  ON email_deliveries (locked_at, id)
  WHERE status = 'processing';
