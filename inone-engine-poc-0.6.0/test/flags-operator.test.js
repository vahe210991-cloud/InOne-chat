// Оператор меняет флаги командой: значение проверяется по правилам кода, причина обязательна, каждое изменение
// попадает в журнал. Тест работает в отдельной базе, чтобы не трогать общие данные.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../src/migrate.js';

const dbTest = process.env.DATABASE_URL ? test : test.skip;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIN = 'test-pepper-0123456789-0123456789-abcd';
const script = path.join(root, 'scripts/set-flag.mjs');

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

dbTest('оператор меняет флаг командой: значение проверяется, причина обязательна, журнал пишется', async () => {
  const name = `inone_flagop_${process.pid}_${Date.now() % 100000}`;
  await admin(`CREATE DATABASE ${name}`);
  const url = withDatabase(process.env.DATABASE_URL, name);
  try {
    const pool = new pg.Pool({ connectionString: url });
    try {
      await migrate(pool);
    } finally {
      await pool.end();
    }
    const set = run(url, ['set', 'maintenance.enabled', 'true', '--actor', 'оператор', '--reason', 'плановые работы сегодня в 10:00']);
    assert.equal(set.status, 0, set.stderr);
    assert.match(set.stdout, /false → true/);
    assert.match(run(url, ['list']).stdout, /maintenance\.enabled = true \(переопределение\)/);
    assert.match(run(url, ['history', 'maintenance.enabled']).stdout, /оператор.*плановые работы/, 'в журнале есть оператор и причина');
    const tooMany = run(url, ['set', 'groups.maxMembers', '900', '--actor', 'оператор', '--reason', 'попытка выйти за предел']);
    assert.notEqual(tooMany.status, 0);
    assert.match(tooMany.stderr, /integer from 2 to 500/, 'значение вне предела отвергнуто');
    const noReason = run(url, ['set', 'files.enabled', 'false', '--actor', 'оператор']);
    assert.notEqual(noReason.status, 0);
    assert.match(noReason.stderr, /причину/, 'без причины не меняется');
    const unknown = run(url, ['set', 'nope.enabled', 'true', '--actor', 'оператор', '--reason', 'неизвестный флаг проверки']);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /unknown flag/);
  } finally {
    await admin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
  }
});
