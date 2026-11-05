-- Push-токены устройств: один на устройство. Уведомление содержит только тип и путь, без содержимого.
CREATE TABLE push_tokens (
  device_key TEXT PRIMARY KEY REFERENCES devices (device_key) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  token TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
