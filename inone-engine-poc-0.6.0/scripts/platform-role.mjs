#!/usr/bin/env node
// Оператор назначает роли платформы: владелец платформы (owner) и администрация (admin — только просмотр документов).
// Роль проверяется по правилам кода, причина обязательна, каждое изменение пишется в журнал действий администраторов.
//   node scripts/platform-role.mjs set <userId> <owner|admin> --actor "<кто>" --reason "<почему, не короче 10 символов>"
//   node scripts/platform-role.mjs unset <userId> --actor "<кто>" --reason "<почему, не короче 10 символов>"
//   node scripts/platform-role.mjs list
// Нужны DATABASE_URL и INONE_PIN_PEPPER.
import pg from 'pg';
import { createStore } from '../src/store.js';

const ROLES = ['owner', 'admin'];

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function option(args, name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

const [command, ...rest] = process.argv.slice(2);
if (!process.env.DATABASE_URL) fail('задайте DATABASE_URL', 2);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const store = createStore({ pool, pinPepper: process.env.INONE_PIN_PEPPER ?? '' });
try {
  if (command === 'list') {
    for (const r of await store.listPlatformRoles()) console.log(`${r.userId}\t${r.role}`);
  } else if (command === 'set' || command === 'unset') {
    const userId = rest[0];
    const actor = option(rest, '--actor');
    const reason = option(rest, '--reason');
    if (!userId) fail('укажите пользователя', 2);
    if (!actor) fail('укажите --actor', 2);
    if (!reason || reason.length < 10) fail('укажите --reason, не короче 10 символов', 2);
    if (!(await store.hasAccount(userId))) fail(`аккаунт не найден: ${userId}`, 3);
    if (command === 'set') {
      const role = rest[1];
      if (!ROLES.includes(role)) fail('роль: owner или admin', 2);
      await store.setPlatformRole(userId, role);
      await store.logAdminAction({ orgId: null, actor, action: 'platform_role_set', target: userId, detail: `${role}; ${reason}`, at: Date.now() });
      console.log(`роль ${role} назначена: ${userId}`);
    } else {
      await store.removePlatformRole(userId);
      await store.logAdminAction({ orgId: null, actor, action: 'platform_role_remove', target: userId, detail: reason, at: Date.now() });
      console.log(`роль снята: ${userId}`);
    }
  } else {
    fail('команда: set | unset | list', 2);
  }
} finally {
  await pool.end();
}
