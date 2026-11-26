// Обновление схемы на PostgreSQL: новая база, старая база из выпуска alpha.21, защита данных.
// Запускается только при заданном DATABASE_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate, listMigrations, MIGRATIONS_DIR } from '../src/migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_SCHEMA = readFileSync(path.join(here, 'fixtures', 'schema-alpha21.sql'), 'utf8');
const URL_ = process.env.DATABASE_URL;

async function assertOrgRequestDocumentMetadata(pool) {
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'org_request_documents' AND column_name IN ('filename', 'mime_type') ORDER BY column_name",
  );
  assert.deepEqual(rows.map((row) => row.column_name), ['filename', 'mime_type']);
}

async function assertDirectConversationSchema(pool) {
  const { rows: tableRows } = await pool.query(
    "SELECT to_regclass('direct_conversations') IS NOT NULL AS present",
  );
  assert.equal(tableRows[0].present, true, 'direct conversation pair table exists');
  const { rows: indexRows } = await pool.query(
    "SELECT to_regclass('direct_conversations_by_user_a') IS NOT NULL AS user_a, to_regclass('direct_conversations_by_user_b') IS NOT NULL AS user_b",
  );
  assert.equal(indexRows[0].user_a && indexRows[0].user_b, true, 'direct conversation participant indexes exist');
  const { rows: roomRows } = await pool.query(
    "SELECT is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'rooms' AND column_name = 'org_id'",
  );
  assert.equal(roomRows[0]?.is_nullable, 'YES', 'personal rooms are not organization-scoped');
  const { rows: kindRows } = await pool.query(
    "SELECT check_clause FROM information_schema.check_constraints WHERE constraint_schema = current_schema() AND constraint_name = 'rooms_kind_check'",
  );
  assert.match(kindRows[0]?.check_clause ?? '', /direct/, 'rooms kind constraint accepts direct chats');
}

async function isolatedPool() {
  const admin = new pg.Pool({ connectionString: URL_, max: 1 });
  const schema = `t_mig_${randomBytes(6).toString('hex')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: URL_, max: 4, options: `-c search_path=${schema}` });
  return {
    pool,
    close: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

test('новая база создаётся из schema.sql и получает все миграции', { skip: !URL_ }, async () => {
  const db = await isolatedPool();
  try {
    assert.deepEqual(await migrate(db.pool), []);
    const { rows } = await db.pool.query('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(rows.map((r) => r.version), listMigrations());
    await assertOrgRequestDocumentMetadata(db.pool);
    await assertDirectConversationSchema(db.pool);
    assert.deepEqual(await migrate(db.pool), [], 'повторный запуск ничего не меняет');
  } finally {
    await db.close();
  }
});

test('старая база из выпуска alpha.21 обновляется, данные сохраняются', { skip: !URL_ }, async () => {
  const db = await isolatedPool();
  try {
    await db.pool.query(LEGACY_SCHEMA);
    await db.pool.query("INSERT INTO accounts (user_id, password_hash) VALUES ('@alice', 'h'), ('@bob', 'h')");
    await db.pool.query("INSERT INTO rooms (room_id, owner) VALUES ('!club', '@alice')");
    await db.pool.query("INSERT INTO room_members (room_id, user_id, is_admin, joined_seq) VALUES ('!club', '@alice', TRUE, 1), ('!club', '@bob', FALSE, 1)");
    const done = await migrate(db.pool);
    assert.equal(done.length, listMigrations().length);
    const caps = Object.fromEntries((await db.pool.query('SELECT user_id, capabilities FROM room_members')).rows.map((r) => [r.user_id, r.capabilities]));
    assert.ok(caps['@alice'].includes('invite_members') && caps['@alice'].includes('remove_members'), 'администратор сохраняет прежние права');
    assert.ok(caps['@bob'].includes('send_messages') && !caps['@bob'].includes('invite_members'), 'участник получает права по умолчанию');
    const room = (await db.pool.query("SELECT owner, visibility, join_policy FROM rooms WHERE room_id = '!club'")).rows[0];
    assert.deepEqual(room, { owner: '@alice', visibility: 'private', join_policy: 'approval' });
    assert.equal((await db.pool.query("SELECT to_regclass('group_assets') IS NOT NULL AS ok")).rows[0].ok, true);
    await assertOrgRequestDocumentMetadata(db.pool);
    await assertDirectConversationSchema(db.pool);
  } finally {
    await db.close();
  }
});

test('миграция, уже применённая вручную, не выполняется повторно и не сбрасывает права', { skip: !URL_ }, async () => {
  const db = await isolatedPool();
  try {
    await db.pool.query(LEGACY_SCHEMA);
    await db.pool.query("INSERT INTO accounts (user_id, password_hash) VALUES ('@alice', 'h'), ('@bob', 'h')");
    await db.pool.query("INSERT INTO rooms (room_id, owner) VALUES ('!club', '@alice')");
    await db.pool.query("INSERT INTO room_members (room_id, user_id, is_admin, joined_seq) VALUES ('!club', '@alice', TRUE, 1), ('!club', '@bob', FALSE, 1)");
    await db.pool.query(readFileSync(path.join(MIGRATIONS_DIR, '0002-room-capabilities.sql'), 'utf8'));
    await db.pool.query("UPDATE room_members SET capabilities = ARRAY['send_messages'] WHERE user_id = '@bob'");
    await migrate(db.pool);
    const bob = (await db.pool.query("SELECT capabilities FROM room_members WHERE user_id = '@bob'")).rows[0].capabilities;
    assert.deepEqual(bob, ['send_messages'], 'выданные владельцем права не перезаписаны');
  } finally {
    await db.close();
  }
});
