-- Схема PoC, версия 0.6.0-alpha.1. Единственный источник правды для таблиц PoC (C-13).
-- Секреты (токены, коды восстановления) хранятся только как ключевые хэши (C-08).

CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL
);

CREATE TABLE devices (
  device_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts (user_id),
  device_id TEXT NOT NULL,
  label TEXT,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  device_key TEXT NOT NULL REFERENCES devices (device_key) ON DELETE CASCADE
);

CREATE TABLE pins (
  user_id TEXT PRIMARY KEY REFERENCES accounts (user_id),
  pin_hash TEXT NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT
);

CREATE TABLE recoveries (
  user_id TEXT PRIMARY KEY REFERENCES accounts (user_id),
  code_hash TEXT NOT NULL,
  not_before BIGINT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE one_time_keys (
  device_key TEXT NOT NULL REFERENCES devices (device_key) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value JSONB NOT NULL,
  PRIMARY KEY (device_key, name)
);

-- Дедупликация отправки (C-05): отправка с одним номером от одного устройства принимается один раз.
CREATE TABLE sends (
  sender_key TEXT NOT NULL,
  type TEXT NOT NULL,
  txn TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (sender_key, type, txn)
);

-- Очередь устройства (C-05, C-20): события доставки и сигналы. Состав устройств и беседы
-- хранятся одной записью на ключ (dedupe_key): повторное изменение заменяет запись.
CREATE SEQUENCE inbox_seq;
CREATE TABLE inbox (
  id BIGINT PRIMARY KEY DEFAULT nextval('inbox_seq'),
  device_key TEXT NOT NULL REFERENCES devices (device_key) ON DELETE CASCADE,
  stream TEXT NOT NULL CHECK (stream IN ('to_device', 'security', 'device_list', 'room')),
  dedupe_key TEXT,
  body JSONB NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX inbox_dedupe ON inbox (device_key, stream, dedupe_key);
CREATE INDEX inbox_by_device ON inbox (device_key, id);

-- Счётчики защиты входа (D7): пара «адрес и логин», адрес, логин. Жёсткой блокировки логина нет.
CREATE TABLE login_throttle (
  key TEXT PRIMARY KEY,
  failed INTEGER NOT NULL DEFAULT 0,
  window_start BIGINT NOT NULL DEFAULT 0,
  blocked_until BIGINT NOT NULL DEFAULT 0
);

-- Запросы подтверждения входа с нового устройства. Код и секрет опроса хранятся как хэши.
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts (user_id),
  device_id TEXT NOT NULL,
  label TEXT,
  platform TEXT,
  code_hash TEXT NOT NULL,
  poll_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX approvals_by_user ON approvals (user_id, status);

-- Восстановление (D1, D5, D8): запрос с кодом, окно 48 часов, проверка входа, лимиты.
-- Всё в базе, чтобы перезапуск сервера не отменял окно и не снимал блокировки.
CREATE TABLE recovery (
  user_id TEXT PRIMARY KEY REFERENCES accounts (user_id),
  req_status TEXT,
  req_started_at BIGINT NOT NULL DEFAULT 0,
  req_expires_at BIGINT NOT NULL DEFAULT 0,
  req_code_hash TEXT,
  req_attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at BIGINT,
  window_key_reset_at BIGINT,
  window_previous_hash TEXT,
  identity_check BOOLEAN NOT NULL DEFAULT FALSE,
  identity_code_hash TEXT,
  identity_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  starts JSONB NOT NULL DEFAULT '[]',
  req_link_hash TEXT,
  req_link_confirmed BOOLEAN NOT NULL DEFAULT FALSE
);

-- Публичные ключи устройства (их загружает само устройство).
CREATE TABLE device_keys (
  device_key TEXT PRIMARY KEY REFERENCES devices (device_key) ON DELETE CASCADE,
  body JSONB NOT NULL
);

-- Общие счётчики. event_seq — номер последнего события беседы: по нему режется история вступающих (C-07).
CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value BIGINT NOT NULL
);
INSERT INTO counters (name, value) VALUES ('event_seq', 0);

-- Беседы: владелец, участники, администраторы и номер, с которого участник видит историю.
CREATE TABLE rooms (
  room_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES accounts (user_id),
  name TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  join_policy TEXT NOT NULL DEFAULT 'approval' CHECK (join_policy IN ('approval', 'open')),
  description TEXT NOT NULL DEFAULT '',
  background_color TEXT,
  avatar_asset_id TEXT,
  cover_asset_id TEXT,
  background_asset_id TEXT
);

CREATE TABLE room_members (
  id BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES accounts (user_id),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  joined_seq BIGINT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  read_seq BIGINT NOT NULL DEFAULT 0,
  UNIQUE (room_id, user_id)
);

-- Заявки на вступление в публичную группу. Одна заявка на пару «группа и пользователь».
CREATE TABLE join_requests (
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES accounts (user_id),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

-- Ссылки-приглашения: в базе только хэш токена. Лимит вступлений и срок проверяются при каждом использовании.
CREATE TABLE invites (
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

-- Файлы оформления. Приватная группа: зашифрованные байты, которые сервер не читает. Публичная: открытые изображения.
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

-- События бесед: только шифротекст, как и раньше.
CREATE TABLE room_events (
  seq BIGINT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  origin_ts BIGINT NOT NULL,
  type TEXT NOT NULL,
  content JSONB NOT NULL
);
CREATE INDEX room_events_by_room ON room_events (room_id, seq);

-- Телефон аккаунта (D5): номер и проверка кодом из SMS. Один подтверждённый номер — один аккаунт.
CREATE TABLE phones (
  user_id TEXT PRIMARY KEY REFERENCES accounts (user_id),
  phone TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  code_hash TEXT,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  code_expires_at BIGINT NOT NULL DEFAULT 0,
  sends JSONB NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX phones_verified_unique ON phones (phone) WHERE verified;

-- Счётчики запросов по окнам времени (D5): регистрация с адреса, восстановление с адреса, SMS на номер.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  hits INTEGER NOT NULL
);

-- Профиль аккаунта (этап 1 модели): подтверждённая почта и никнейм. Почта другим не показывается.
CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES accounts (user_id),
  email TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT TRUE,
  nickname TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  locale TEXT NOT NULL DEFAULT 'hy' CHECK (locale IN ('hy', 'ru', 'en'))
);
CREATE UNIQUE INDEX profiles_email_verified ON profiles (lower(email)) WHERE email_verified;
CREATE UNIQUE INDEX profiles_nickname ON profiles (lower(nickname));

-- Коды подтверждения почты при регистрации и одноразовые токены регистрации.
CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
  locale TEXT NOT NULL DEFAULT 'hy' CHECK (locale IN ('hy', 'ru', 'en')),
  code_hash TEXT,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  code_expires_at BIGINT NOT NULL DEFAULT 0,
  token_hash TEXT,
  token_expires_at BIGINT NOT NULL DEFAULT 0
);

-- Связи с внешними аккаунтами (этап 2): Google и Apple. Один внешний аккаунт — один аккаунт InOne.
CREATE TABLE provider_links (
  provider TEXT NOT NULL,
  sub TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES accounts (user_id),
  email TEXT NOT NULL,
  linked_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, sub),
  CONSTRAINT provider_links_user_provider UNIQUE (user_id, provider)
);

-- Короткоживущие одноразовые токены: nonce, билет регистрации, подтверждение входа через провайдера.
CREATE TABLE auth_tokens (
  kind TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  user_id TEXT,
  payload TEXT,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (kind, token_hash)
);

-- Запасная почта аккаунта (необязательна, подтверждённая): один адрес — один аккаунт.
CREATE TABLE backup_emails (
  user_id TEXT PRIMARY KEY REFERENCES accounts (user_id),
  email TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX backup_emails_email ON backup_emails (lower(email));

-- Отложенный вход с нового устройства, когда в аккаунте нет активных устройств (решение владельца: 48 часов для аккаунта только с почтой).
CREATE TABLE device_waits (
  user_id TEXT NOT NULL REFERENCES accounts (user_id),
  device_id TEXT NOT NULL,
  label TEXT,
  platform TEXT,
  activate_at BIGINT NOT NULL,
  cancel_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, device_id)
);

-- Код отмены восстановления: уходит на все адреса аккаунта, действует, пока открыто окно (48 часов).
CREATE TABLE recovery_cancel_codes (
  user_id TEXT PRIMARY KEY REFERENCES accounts (user_id),
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);

-- Открытый ключ устройства для биометрического подтверждения (этап 2б). Закрытый ключ не покидает устройство.
CREATE TABLE device_signing_keys (
  device_key TEXT PRIMARY KEY REFERENCES devices (device_key),
  public_jwk TEXT NOT NULL,
  created_at BIGINT NOT NULL DEFAULT 0
);

-- Ключевые пакеты MLS (см. migrations/0007-mls-key-packages.sql).
CREATE TABLE mls_key_packages (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  package BYTEA NOT NULL,
  created_at BIGINT NOT NULL,
  consumed_at BIGINT
);
CREATE INDEX mls_key_packages_available ON mls_key_packages (user_id, device_id, id) WHERE consumed_at IS NULL;

-- Номер телефона принадлежит одному аккаунту (см. migrations/0008-phone-unique.sql).
CREATE UNIQUE INDEX phones_phone_unique ON phones (phone) WHERE phone IS NOT NULL;

-- Группы MLS (см. migrations/0009-mls-groups.sql).
-- Первичный ключ (room_id, epoch) не даёт двум коммитам занять одну эпоху даже при гонке запросов.
CREATE TABLE mls_groups (
  room_id TEXT PRIMARY KEY REFERENCES rooms (room_id) ON DELETE CASCADE,
  epoch BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE mls_commits (
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  epoch BIGINT NOT NULL,
  sender_id TEXT NOT NULL,
  commit BYTEA NOT NULL,
  changes JSONB,
  welcome_recipients JSONB,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, epoch)
);
CREATE TABLE mls_welcomes (
  id BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  epoch BIGINT NOT NULL,
  user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  welcome BYTEA NOT NULL,
  created_at BIGINT NOT NULL,
  acked_at BIGINT
);
CREATE INDEX mls_welcomes_pending ON mls_welcomes (user_id, device_id) WHERE acked_at IS NULL;

-- Типы комнат и уникальность названий каналов (см. migrations/0010-channels.sql).
-- Название группы может повторяться: индекс только для каналов.
ALTER TABLE rooms ADD COLUMN kind TEXT NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'channel', 'direct'));
ALTER TABLE rooms ADD CONSTRAINT rooms_channel_has_name CHECK (kind = 'group' OR name IS NOT NULL);
CREATE UNIQUE INDEX rooms_channel_name_unique ON rooms ((lower(regexp_replace(name, '\s+', ' ', 'g')))) WHERE kind = 'channel';


-- Резервный ключевой пакет (см. migrations/0011-last-resort.sql).
ALTER TABLE mls_key_packages ADD COLUMN last_resort BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX mls_key_packages_last_resort ON mls_key_packages (user_id, device_id) WHERE last_resort;

-- Отозванные устройства в группах MLS (см. migrations/0012-device-removals.sql).
CREATE TABLE mls_device_removals (
  id BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  done_at BIGINT,
  UNIQUE (room_id, user_id, device_id)
);

-- Идентификаторы сообщений клиента (см. migrations/0013-client-message-id.sql).
CREATE TABLE mls_client_messages (
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  PRIMARY KEY (room_id, user_id, client_message_id)
);

-- Резервирование повтора (см. migrations/0014-client-message-reserve.sql).
ALTER TABLE mls_client_messages ALTER COLUMN seq DROP NOT NULL;

-- Сессии (см. migrations/0015-sessions.sql).
ALTER TABLE tokens ADD COLUMN expires_at BIGINT NOT NULL DEFAULT 0;
CREATE TABLE refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  device_key TEXT NOT NULL REFERENCES devices (device_key) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  used_at BIGINT
);

-- Файлы (см. migrations/0016-files.sql).
CREATE TABLE files (
  file_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_device_id TEXT NOT NULL DEFAULT '',
  room_id TEXT REFERENCES rooms (room_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  completed_at BIGINT
);
CREATE INDEX files_status_created ON files (status, created_at);

-- Push-токены устройств (см. migrations/0017-push.sql).
CREATE TABLE push_tokens (
  device_key TEXT PRIMARY KEY REFERENCES devices (device_key) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  token TEXT,
  token_ciphertext BYTEA,
  token_iv BYTEA,
  token_tag BYTEA,
  identifier_kind TEXT NOT NULL DEFAULT 'legacy' CHECK (identifier_kind IN ('fid', 'legacy')),
  updated_at BIGINT NOT NULL
);

-- Durable push outbox, deliberately separate from Email Delivery.
CREATE TABLE IF NOT EXISTS push_deliveries (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key CHAR(64) NOT NULL UNIQUE,
  device_key TEXT NOT NULL REFERENCES devices (device_key) ON DELETE CASCADE,
  payload_ciphertext BYTEA NOT NULL,
  payload_iv BYTEA NOT NULL,
  payload_tag BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'failed', 'provider_accepted', 'dead', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  CHECK ((status = 'processing') = (locked_at IS NOT NULL AND locked_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS push_deliveries_ready ON push_deliveries (available_at, id) WHERE status IN ('queued', 'failed');
CREATE INDEX IF NOT EXISTS push_deliveries_stale ON push_deliveries (locked_at, id) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS push_deliveries_device ON push_deliveries (device_key, status, id);

-- Флаги функций (см. migrations/0018-flags.sql).
CREATE TABLE feature_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE flag_changes (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_at BIGINT NOT NULL
);

-- Отметки доставки (см. migrations/0019-delivery-marks.sql).
CREATE TABLE delivery_marks (
  device_key TEXT NOT NULL REFERENCES devices (device_key) ON DELETE CASCADE,
  stream TEXT NOT NULL,
  delivered BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (device_key, stream)
);

-- Организации (см. migrations/0020-organizations.sql).
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
ALTER TABLE rooms ADD COLUMN org_id TEXT REFERENCES organizations (org_id);

-- Personal one-to-one conversations (Beta 1.0); the pair is canonical and unordered.
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


-- Заявки на создание организации (см. migrations/0021-org-requests.sql).
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
  filename TEXT NOT NULL DEFAULT 'document.bin',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
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

-- Настройки организации (см. migrations/0022-org-settings.sql).
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

-- Связи между организациями (см. migrations/0023-org-links.sql).
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

-- Журнал действий администраторов (см. migrations/0024-admin-actions.sql).
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

-- Durable MLS KeyPackage claim results (см. migrations/0026-mls-key-package-claim-replay.sql).
CREATE TABLE mls_key_package_claims (
  target_user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  requester_user_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  requester_device_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  room_id TEXT REFERENCES rooms (room_id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'committed', 'released')),
  result JSONB,
  created_at BIGINT NOT NULL,
  committed_at BIGINT,
  released_at BIGINT,
  PRIMARY KEY (target_user_id, requester_user_id, requester_device_id, claim_id)
);
CREATE INDEX mls_key_package_claims_created ON mls_key_package_claims (created_at);
CREATE INDEX mls_key_package_claims_room_state ON mls_key_package_claims (room_id, state);

-- A membership commit retry must resolve to the exact accepted epoch.
CREATE TABLE IF NOT EXISTS mls_commit_operations (
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES accounts (user_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  client_operation_id TEXT NOT NULL CHECK (client_operation_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  request_fingerprint CHAR(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  resulting_epoch BIGINT NOT NULL CHECK (resulting_epoch >= 1),
  created_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, sender_id, device_id, client_operation_id)
);
CREATE INDEX IF NOT EXISTS mls_commit_operations_created
  ON mls_commit_operations (created_at);

-- Durable encrypted email delivery queue (0029).
CREATE TABLE IF NOT EXISTS email_deliveries (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key CHAR(64) NOT NULL UNIQUE,
  payload_fingerprint CHAR(64) NOT NULL,
  payload_ciphertext BYTEA NOT NULL,
  payload_iv BYTEA NOT NULL,
  payload_tag BYTEA NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sent', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  CHECK ((status = 'processing') = (locked_at IS NOT NULL AND locked_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS email_deliveries_ready
  ON email_deliveries (available_at, id)
  WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS email_deliveries_stale
  ON email_deliveries (locked_at, id)
  WHERE status = 'processing';


-- Stage 4 schema baseline: same definitions as migrations 0034 and 0035.
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx
  ON rate_limits (window_start);
CREATE INDEX IF NOT EXISTS login_throttle_expiry_idx
  ON login_throttle (window_start, blocked_until);
ALTER TABLE push_deliveries
  ADD COLUMN IF NOT EXISTS registration_generation CHAR(64);
CREATE INDEX IF NOT EXISTS push_deliveries_registration_generation_idx
  ON push_deliveries (device_key, registration_generation, status);
