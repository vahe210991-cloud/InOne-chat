-- Настройки организации (шаг 5.5): лимит группы, каналы, квота файлов; журнал изменений.
CREATE TABLE org_settings (
  org_id TEXT PRIMARY KEY REFERENCES organizations (org_id) ON DELETE CASCADE,
  max_group_members INTEGER,
  channels_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  file_quota_bytes BIGINT
);
CREATE TABLE org_settings_log (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations (org_id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('maxGroupMembers', 'channelsEnabled', 'fileQuotaBytes')),
  old_value TEXT,
  new_value TEXT,
  at BIGINT NOT NULL
);
