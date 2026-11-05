-- Группы MLS: эпоха группы, коммиты и приветственные сообщения. Сервер хранит их как непрозрачные байты.
-- Первичный ключ (room_id, epoch) не даёт двум коммитам занять одну эпоху даже при гонке запросов.
CREATE TABLE mls_groups (
  room_id TEXT PRIMARY KEY REFERENCES rooms (room_id) ON DELETE CASCADE,
  epoch BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE mls_commits (
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  epoch BIGINT NOT NULL,
  sender_id TEXT NOT NULL,
  commit BYTEA NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, epoch)
);
CREATE TABLE mls_welcomes (
  id BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  epoch BIGINT NOT NULL,
  user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  welcome BYTEA NOT NULL,
  created_at BIGINT NOT NULL,
  acked_at BIGINT
);
CREATE INDEX mls_welcomes_pending ON mls_welcomes (user_id, device_id) WHERE acked_at IS NULL;
