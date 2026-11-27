// Обновление схемы базы. Новая база создаётся из schema.sql. Старая база получает только то,
// чего в ней ещё нет: признаки применённых миграций проверяются по структуре, данные не переписываются.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { createLogger } from './logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_FILE = path.join(here, 'schema.sql');
export const MIGRATIONS_DIR = path.join(here, '..', 'migrations');
/** Последняя миграция, уже включённая в schema.sql. Обновляется вместе с каждой новой миграцией. */
export const SCHEMA_VERSION = '0037-contacts-and-blocks';
const LOCK_KEY = 727001;

/** Признак того, что миграция уже применена в базе, созданной до появления таблицы миграций. */
const MARKERS = {
  '0002-room-capabilities': "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'room_members' AND column_name = 'capabilities')",
  '0003-room-settings-and-reads': "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'rooms' AND column_name = 'visibility') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'room_members' AND column_name = 'read_seq')",
  '0004-public-groups': "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'rooms' AND column_name = 'join_policy') AND to_regclass('join_requests') IS NOT NULL",
  '0005-invites': "to_regclass('invites') IS NOT NULL",
  '0006-group-appearance': "to_regclass('group_assets') IS NOT NULL",
  '0007-mls-key-packages': "to_regclass('mls_key_packages') IS NOT NULL",
  '0008-phone-unique': "to_regclass('phones_phone_unique') IS NOT NULL",
  '0009-mls-groups': "to_regclass('mls_commits') IS NOT NULL",
  '0010-channels': "to_regclass('rooms_channel_name_unique') IS NOT NULL",
  '0011-last-resort': "to_regclass('mls_key_packages_last_resort') IS NOT NULL",
  '0012-device-removals': "to_regclass('mls_device_removals') IS NOT NULL",
  '0013-client-message-id': "to_regclass('mls_client_messages') IS NOT NULL",
  '0014-client-message-reserve': "(SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_name = 'mls_client_messages' AND column_name = 'seq')",
  '0015-sessions': "to_regclass('refresh_tokens') IS NOT NULL",
  '0016-files': "to_regclass('files') IS NOT NULL",
  '0017-push': "to_regclass('push_tokens') IS NOT NULL",
  '0018-flags': "to_regclass('feature_flags') IS NOT NULL",
  '0019-delivery-marks': "to_regclass('delivery_marks') IS NOT NULL",
  '0020-organizations': "to_regclass('organizations') IS NOT NULL",
  '0021-org-requests': "to_regclass('org_requests') IS NOT NULL",
  '0022-org-settings': "to_regclass('org_settings') IS NOT NULL",
  '0023-org-links': "to_regclass('org_links') IS NOT NULL",
  '0024-admin-actions': "to_regclass('admin_action_log') IS NOT NULL",
  '0025-mls-commit-change-metadata': "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'mls_commits' AND column_name = 'changes') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'mls_commits' AND column_name = 'welcome_recipients')",
  '0026-mls-key-package-claim-replay': "to_regclass('mls_key_package_claims') IS NOT NULL",
  '0027-mls-commit-idempotency': "to_regclass('mls_commit_operations') IS NOT NULL",
  '0028-mls-key-package-claim-reservation-finalization': "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'mls_key_package_claims' AND column_name = 'room_id') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'mls_key_package_claims' AND column_name = 'state')",
  '0029-email-delivery': "to_regclass('email_deliveries') IS NOT NULL",
  '0030-profile-email-locale': "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'profiles' AND column_name = 'locale') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'email_codes' AND column_name = 'locale')",
  '0031-file-upload-device-binding': "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'files' AND column_name = 'owner_device_id')",
  '0032-push-delivery-queue': "to_regclass('push_deliveries') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'push_tokens' AND column_name = 'token_ciphertext')",
  '0033-org-request-document-metadata': "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'org_request_documents' AND column_name = 'filename') AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'org_request_documents' AND column_name = 'mime_type')",
  '0034-expired-security-state-indexes': "to_regclass('rate_limits_window_start_idx') IS NOT NULL AND to_regclass('login_throttle_expiry_idx') IS NOT NULL",
  '0035-push-registration-generations': "EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'push_deliveries' AND column_name = 'registration_generation') AND to_regclass('push_deliveries_registration_generation_idx') IS NOT NULL",
  '0036-direct-conversations': "to_regclass('direct_conversations') IS NOT NULL AND to_regclass('direct_conversations_by_user_a') IS NOT NULL AND to_regclass('direct_conversations_by_user_b') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'rooms' AND column_name = 'org_id' AND is_nullable = 'YES') AND EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_schema = current_schema() AND constraint_name = 'rooms_kind_check' AND check_clause LIKE '%direct%')",
  '0037-contacts-and-blocks': "to_regclass('contacts') IS NOT NULL AND to_regclass('contact_requests') IS NOT NULL AND to_regclass('user_blocks') IS NOT NULL AND to_regclass('contact_requests_by_recipient_pending') IS NOT NULL",
};

export function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();
}

/** Применяет недостающие миграции. Возвращает список версий, которые выполнены сейчас. */
export async function migrate(pool, { logger = null } = {}) {
  const client = await pool.connect();
  const done = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const recorded = (await client.query('SELECT version FROM schema_migrations')).rows.length;
    if (recorded === 0) {
      const { rows } = await client.query("SELECT to_regclass('accounts') IS NOT NULL AS has_accounts");
      if (!rows[0].has_accounts) {
        // Новая база: схема целиком из schema.sql, она уже содержит миграции до SCHEMA_VERSION.
        await client.query('BEGIN');
        await client.query(readFileSync(SCHEMA_FILE, 'utf8'));
        for (const version of listMigrations()) {
          if (version <= SCHEMA_VERSION) await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        }
        await client.query('COMMIT');
        logger?.info('database created from schema', { version: SCHEMA_VERSION });
      } else {
        // Старая база без таблицы миграций: отмечаем то, что уже есть по структуре.
        for (const version of listMigrations()) {
          const { rows: found } = await client.query(`SELECT ${MARKERS[version] ?? 'false'} AS present`);
          if (!found[0].present) break;
          await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        }
      }
    }
    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    for (const version of listMigrations()) {
      if (applied.has(version)) continue;
      const sql = readFileSync(path.join(MIGRATIONS_DIR, `${version}.sql`), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${version} failed: ${error.message}`);
      }
      done.push(version);
      logger?.info('migration applied', { version });
    }
    return done;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

// Запуск из командной строки: node src/migrate.js
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // Миграциям нужен только адрес базы: почтовый транспорт для них не требуется.
  if (!process.env.DATABASE_URL) {
    process.stderr.write('DATABASE_URL is required\n');
    process.exit(1);
  }
  const logger = createLogger({ level: process.env.LOG_LEVEL ?? 'info' });
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const done = await migrate(pool, { logger });
    logger.info('migrations finished', { applied: done.length });
  } catch (error) {
    logger.error('migrations failed', { error: error.message });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
