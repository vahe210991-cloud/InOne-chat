-- Заявки на создание организации (шаг 5.3): заявка, документы (байты — в объектном хранилище), журнал решений и просмотров, роли платформы.
CREATE TABLE platform_roles (
  user_id TEXT PRIMARY KEY REFERENCES accounts (user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin'))
);
CREATE TABLE org_requests (
  request_id TEXT PRIMARY KEY,
  applicant_id TEXT NOT NULL REFERENCES accounts (user_id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  org_id TEXT REFERENCES organizations (org_id),
  created_at BIGINT NOT NULL,
  decided_at BIGINT,
  decided_by TEXT REFERENCES accounts (user_id)
);
CREATE TABLE org_request_documents (
  doc_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES org_requests (request_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES accounts (user_id),
  created_at BIGINT NOT NULL
);
CREATE TABLE org_request_log (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES org_requests (request_id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'document', 'view', 'approve', 'reject')),
  at BIGINT NOT NULL
);
