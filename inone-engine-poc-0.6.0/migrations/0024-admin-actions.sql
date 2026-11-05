-- Журнал действий администраторов (шаг 5.7): участники, роли, связи, настройки организаций и роли платформы.
CREATE TABLE admin_action_log (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT REFERENCES organizations (org_id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('member_add', 'member_remove', 'role_change', 'member_leave', 'link_propose', 'link_accept', 'link_revoke', 'setting_change', 'platform_role_set', 'platform_role_remove')),
  target TEXT,
  detail TEXT,
  at BIGINT NOT NULL
);
