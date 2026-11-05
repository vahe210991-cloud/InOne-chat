-- Ключевые пакеты MLS. Сервер хранит их как непрозрачные байты и выдаёт каждый пакет один раз.
CREATE TABLE mls_key_packages (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  package BYTEA NOT NULL,
  created_at BIGINT NOT NULL,
  consumed_at BIGINT
);
CREATE INDEX mls_key_packages_available ON mls_key_packages (user_id, device_id, id) WHERE consumed_at IS NULL;
