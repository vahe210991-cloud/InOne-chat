-- Публичные группы: политика вступления и заявки на вступление.
-- По умолчанию вступление по заявке. Приватная группа заявок не принимает.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS join_policy TEXT NOT NULL DEFAULT 'approval' CHECK (join_policy IN ('approval', 'open'));
CREATE TABLE IF NOT EXISTS join_requests (
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES accounts (user_id),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
