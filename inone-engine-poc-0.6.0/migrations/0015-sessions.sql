-- Сессии: токен доступа живёт 15 минут; токен обновления одноразовый и живёт 30 дней.
-- Прежние токены (без срока) получают срок 0 и перестают действовать: нужен новый вход.
ALTER TABLE tokens ADD COLUMN expires_at BIGINT NOT NULL DEFAULT 0;
CREATE TABLE refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  device_key TEXT NOT NULL REFERENCES devices (device_key) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);
