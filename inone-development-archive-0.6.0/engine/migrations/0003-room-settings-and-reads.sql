-- Название и видимость беседы; позиция чтения участника. Значения по умолчанию: без названия, приватная.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public'));
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS read_seq BIGINT NOT NULL DEFAULT 0;
