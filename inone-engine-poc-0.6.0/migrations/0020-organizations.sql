-- Организации (мультиарендность): организация, членство с ролью и организация комнаты.
-- Существующие комнаты переходят в организацию по умолчанию; существующие аккаунты становятся её участниками.
CREATE TABLE organizations (
  org_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by TEXT REFERENCES accounts (user_id),
  created_at BIGINT NOT NULL
);
CREATE TABLE org_members (
  org_id TEXT NOT NULL REFERENCES organizations (org_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
INSERT INTO organizations (org_id, name, status, created_by, created_at) VALUES ('org-default', 'Основная', 'approved', NULL, 0);
INSERT INTO org_members (org_id, user_id, role, joined_at) SELECT 'org-default', user_id, 'member', 0 FROM accounts;
ALTER TABLE rooms ADD COLUMN org_id TEXT NOT NULL DEFAULT 'org-default' REFERENCES organizations (org_id);
