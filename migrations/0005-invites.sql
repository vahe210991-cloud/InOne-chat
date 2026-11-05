-- Ссылки-приглашения. В базе хранится только хэш токена.
CREATE TABLE IF NOT EXISTS invites (
  invite_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES accounts (user_id),
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  revoked BOOLEAN NOT NULL DEFAULT FALSE
);
