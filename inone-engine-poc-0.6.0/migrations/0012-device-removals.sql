-- Отозванные устройства, которые ещё стоят в группах MLS: их листья должны удалить коммитом.
CREATE TABLE mls_device_removals (
  id BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  done_at BIGINT,
  UNIQUE (room_id, user_id, device_id)
);
