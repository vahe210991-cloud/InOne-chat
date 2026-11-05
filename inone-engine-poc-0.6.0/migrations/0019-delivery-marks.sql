-- Наибольший номер, который сервер уже отдал устройству (по каждому потоку). Подтверждение выше этой отметки не принимается.
CREATE TABLE delivery_marks (
  device_key TEXT NOT NULL REFERENCES devices (device_key) ON DELETE CASCADE,
  stream TEXT NOT NULL,
  delivered BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (device_key, stream)
);
