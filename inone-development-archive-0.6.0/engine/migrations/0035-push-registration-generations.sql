-- Bind each durable push delivery to the encrypted registration generation
-- that existed when the event was enqueued. This value is a keyed fingerprint,
-- never the raw Firebase Installation ID or registration ciphertext.
ALTER TABLE push_deliveries
  ADD COLUMN IF NOT EXISTS registration_generation CHAR(64);

CREATE INDEX IF NOT EXISTS push_deliveries_registration_generation_idx
  ON push_deliveries (device_key, registration_generation, status);
