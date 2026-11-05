-- Связи между организациями (шаг 5.6): по умолчанию закрыты; открываются предложением одной стороны и согласием другой.
CREATE TABLE org_links (
  link_id TEXT PRIMARY KEY,
  org_a TEXT NOT NULL REFERENCES organizations (org_id) ON DELETE CASCADE,
  org_b TEXT NOT NULL REFERENCES organizations (org_id) ON DELETE CASCADE,
  proposed_by_org TEXT NOT NULL REFERENCES organizations (org_id),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'active', 'revoked')),
  proposed_by TEXT NOT NULL REFERENCES accounts (user_id),
  decided_by TEXT REFERENCES accounts (user_id),
  created_at BIGINT NOT NULL,
  decided_at BIGINT,
  CHECK (org_a < org_b),
  UNIQUE (org_a, org_b)
);
