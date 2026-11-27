-- Contact requests are independent from message delivery. A first message can be
-- delivered through MLS before the recipient accepts the sender into their contacts.
CREATE TABLE contacts (
  owner_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  contact_user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  CHECK (owner_id <> contact_user_id),
  PRIMARY KEY (owner_id, contact_user_id)
);
CREATE INDEX contacts_by_contact_user ON contacts (contact_user_id, owner_id);

CREATE TABLE contact_requests (
  requester_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES direct_conversations (room_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at BIGINT NOT NULL,
  decided_at BIGINT,
  CHECK (requester_id <> recipient_id),
  CHECK ((status = 'pending' AND decided_at IS NULL) OR (status <> 'pending' AND decided_at IS NOT NULL)),
  PRIMARY KEY (requester_id, recipient_id)
);
CREATE INDEX contact_requests_by_recipient_pending
  ON contact_requests (recipient_id, created_at)
  WHERE status = 'pending';

CREATE TABLE user_blocks (
  blocker_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  CHECK (blocker_id <> blocked_id),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX user_blocks_by_blocked ON user_blocks (blocked_id, blocker_id);
