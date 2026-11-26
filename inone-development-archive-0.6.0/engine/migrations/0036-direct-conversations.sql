-- Beta 1.0 direct conversations: one private MLS room per unordered account pair.
-- Direct conversations are personal, not organization-scoped. Their server roster
-- is still changed only by MLS Add/Remove Commit transactions.
ALTER TABLE rooms ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_kind_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_kind_check CHECK (kind IN ('group', 'channel', 'direct'));

CREATE TABLE direct_conversations (
  room_id TEXT PRIMARY KEY REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_a TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES accounts (user_id),
  status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'active')),
  created_at BIGINT NOT NULL,
  CHECK (user_a COLLATE "C" < user_b COLLATE "C"),
  CHECK (created_by = user_a OR created_by = user_b),
  UNIQUE (user_a, user_b)
);
CREATE INDEX direct_conversations_by_user_a ON direct_conversations (user_a, status);
CREATE INDEX direct_conversations_by_user_b ON direct_conversations (user_b, status);
