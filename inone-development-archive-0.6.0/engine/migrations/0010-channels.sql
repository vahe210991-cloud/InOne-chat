-- Типы комнат: группа или канал. Название канала уникально (без учёта регистра и лишних пробелов).
-- Название группы может повторяться: индекс только для каналов.
ALTER TABLE rooms ADD COLUMN kind TEXT NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'channel'));
ALTER TABLE rooms ADD CONSTRAINT rooms_channel_has_name CHECK (kind = 'group' OR name IS NOT NULL);
CREATE UNIQUE INDEX rooms_channel_name_unique ON rooms ((lower(regexp_replace(name, '\s+', ' ', 'g')))) WHERE kind = 'channel';
