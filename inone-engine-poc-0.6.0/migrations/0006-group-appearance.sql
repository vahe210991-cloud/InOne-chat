-- Оформление группы: описание, фон, аватар, обложка и файлы (включая собственные стикеры).
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS background_color TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS avatar_asset_id TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS cover_asset_id TEXT;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS background_asset_id TEXT;
CREATE TABLE group_assets (
  asset_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('avatar', 'cover', 'background', 'sticker')),
  content_type TEXT NOT NULL,
  encrypted BOOLEAN NOT NULL,
  size_bytes INTEGER NOT NULL,
  data BYTEA NOT NULL,
  shortcode TEXT,
  created_by TEXT NOT NULL REFERENCES accounts (user_id),
  created_at BIGINT NOT NULL
);
ALTER TABLE rooms ADD CONSTRAINT rooms_avatar_asset_fk FOREIGN KEY (avatar_asset_id) REFERENCES group_assets (asset_id) ON DELETE SET NULL;
ALTER TABLE rooms ADD CONSTRAINT rooms_cover_asset_fk FOREIGN KEY (cover_asset_id) REFERENCES group_assets (asset_id) ON DELETE SET NULL;
ALTER TABLE rooms ADD CONSTRAINT rooms_background_asset_fk FOREIGN KEY (background_asset_id) REFERENCES group_assets (asset_id) ON DELETE SET NULL;
