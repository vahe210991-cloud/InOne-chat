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
  owner TEXT NOT NULL REFERENCES accounts (user_id)
);

CREATE TABLE room_members (
  id BIGSERIAL PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms (room_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES accounts (user_id),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  joined_seq BIGINT NOT NULL,
  UNIQUE (room_id, user_id)
);

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
  created_at BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX profiles_email_verified ON profiles (lower(email)) WHERE email_verified;
CREATE UNIQUE INDEX profiles_nickname ON profiles (lower(nickname));

-- Коды подтверждения почты при регистрации и одноразовые токены регистрации.
CREATE TABLE email_codes (
  email TEXT PRIMARY KEY,
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
