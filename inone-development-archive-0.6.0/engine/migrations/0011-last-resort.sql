-- Резервный ключевой пакет: один на устройство. Выдаётся, когда обычные пакеты закончились; не расходуется.
ALTER TABLE mls_key_packages ADD COLUMN last_resort BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX mls_key_packages_last_resort ON mls_key_packages (user_id, device_id) WHERE last_resort;
