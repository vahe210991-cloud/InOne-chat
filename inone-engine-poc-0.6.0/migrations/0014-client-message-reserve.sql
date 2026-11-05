-- Резервирование повтора: строка создаётся до записи события (seq пуст), затем получает номер события.
ALTER TABLE mls_client_messages ALTER COLUMN seq DROP NOT NULL;
