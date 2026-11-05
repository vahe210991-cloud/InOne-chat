// Оператор назначает роли платформы командой (шаг 5.7): роль проверяется, причина обязательна,
// аккаунт должен существовать; каждое изменение пишется в журнал. Тест работает в отдельной базе.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../src/migrate.js';
import { createStore } from '../src/store.js';

const dbTest = process.env.DATABASE_URL ? test : test.skip;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN = 'test-pepper-0123456789-0123456789-abcd';
const script = path.join(root, 'scripts/platform-role.mjs');
const USER = '@operator-role:inone.test';

function withDatabase(url, name) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

async function admin(sql) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

function run(url, args) {
  return spawnSync('node', [script, ...args], { env: { ...process.env, DATABASE_URL: url, INONE_PIN_PEPPER: PIN }, encoding: 'utf8' });
}

dbTest('оператор назначает роль платформы командой: роль проверяется, причина обязательна, изменение в журнале', async () => {
  const name = `inone_rolop_${process.pid}_${Date.now() % 100000}`;
  await admin(`CREATE DATABASE ${name}`);
  const url = withDatabase(process.env.DATABASE_URL, name);
  const pool = new pg.Pool({ connectionString: url });
  try {
    await migrate(pool);
    const store = createStore({ pool, pinPepper: PIN });
    await store.addAccount(USER, 'hash-operator');
    const noReason = run(url, ['set', USER, 'admin', '--actor', 'owner-1']);
    assert.notEqual(noReason.status, 0, 'без причины роль не назначается');
    const badRole = run(url, ['set', USER, 'superuser', '--actor', 'owner-1', '--reason', 'назначение для проверки']);
    assert.notEqual(badRole.status, 0, 'неизвестная роль отвергнута');
    assert.equal(await store.platformRoleOf(USER), null, 'после отказов роли нет');
    const ok = run(url, ['set', USER, 'admin', '--actor', 'owner-1', '--reason', 'администрация платформы, просмотр документов']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(await store.platformRoleOf(USER), 'admin');
    const listed = run(url, ['list']);
    assert.ok(listed.stdout.includes(`${USER}\tadmin`), 'список показывает назначенную роль');
    const journal = await store.listAdminActions(null);
    const entry = journal.find((a) => a.action === 'platform_role_set' && a.target === USER);
    assert.ok(entry, 'назначение записано в журнал');
    assert.equal(entry.actor, 'owner-1', 'в журнале указан оператор');
    const removed = run(url, ['unset', USER, '--actor', 'owner-1', '--reason', 'роль больше не нужна']);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(await store.platformRoleOf(USER), null, 'роль снята');
    assert.ok((await store.listAdminActions(null)).some((a) => a.action === 'platform_role_remove' && a.target === USER), 'снятие записано в журнал');
  } finally {
    await pool.end();
    await admin(`DROP DATABASE IF EXISTS ${name}`);
  }
});
