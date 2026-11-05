#!/usr/bin/env node
// Оператор меняет флаг функции. Значение проверяется по правилам кода; переопределение, оператор и причина
// пишутся в журнал. Нужен DATABASE_URL.
//   node scripts/set-flag.mjs set <ключ> <значение> --actor "<кто>" --reason "<почему, не короче 10 символов>"
//   node scripts/set-flag.mjs list
//   node scripts/set-flag.mjs history <ключ>
import pg from 'pg';
import { createStore } from '../src/store.js';
import { FLAG_DEFAULTS, effectiveFlags, validateFlag } from '../src/flags.js';

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseValue(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

const [command, ...rest] = process.argv.slice(2);
if (!process.env.DATABASE_URL) fail('задайте DATABASE_URL', 2);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const store = createStore({ pool, pinPepper: process.env.INONE_PIN_PEPPER ?? '' });
try {
  if (command === 'set') {
    const [key, raw] = rest;
    const actor = option(rest, '--actor');
    const reason = option(rest, '--reason');
    if (!key || raw === undefined) fail('использование: set <ключ> <значение> --actor "<кто>" --reason "<почему>"', 2);
    if (!actor || actor.trim().length < 2) fail('укажите оператора: --actor "<кто>"');
    if (!reason || reason.trim().length < 10) fail('укажите причину: --reason "<почему, не короче 10 символов>"');
    const value = validateFlag(key, parseValue(raw));
    const before = effectiveFlags(await store.flagOverrides())[key];
    await store.setFlag(key, value, actor.trim(), reason.trim(), Date.now());
    console.log(`флаг ${key}: ${before} → ${value} (оператор ${actor.trim()})`);
  } else if (command === 'list') {
    const overrides = await store.flagOverrides();
    const current = effectiveFlags(overrides);
    for (const key of Object.keys(FLAG_DEFAULTS)) {
      const source = key in overrides ? 'переопределение' : 'умолчание';
      console.log(`${key} = ${current[key]} (${source})`);
    }
  } else if (command === 'history') {
    const [key] = rest;
    if (!key) fail('использование: history <ключ>', 2);
    for (const row of await store.flagHistory(key)) {
      console.log(`${new Date(Number(row.changed_at)).toISOString()}  ${row.old_value ?? '—'} → ${row.new_value}  ${row.actor}  «${row.reason}»`);
    }
  } else {
    fail('команды: set, list, history', 2);
  }
} catch (error) {
  fail(error.message);
} finally {
  await pool.end();
}
