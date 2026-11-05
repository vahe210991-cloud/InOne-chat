-- Флаги функций: переопределения оператора и журнал изменений (с именем оператора и причиной).
CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE flag_changes (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_at BIGINT NOT NULL
);
