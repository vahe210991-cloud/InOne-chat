-- Файлы: метаданные загрузки. Сами байты лежат в объектном хранилище и приходят зашифрованными от клиента.
CREATE TABLE files (
  file_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  room_id TEXT REFERENCES rooms (room_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  completed_at BIGINT
);
CREATE INDEX files_status_created ON files (status, created_at);
