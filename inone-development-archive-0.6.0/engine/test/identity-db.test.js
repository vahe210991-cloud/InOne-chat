import { randomBytes } from 'node:crypto';
// Этап 1 модели аккаунта на PostgreSQL: почта и никнейм переживают перезапуск, уникальность держит база.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createStore } from '../src/store.js';
import { testDatabase } from './helpers.js';
import { hashPin } from '../src/pin-security.js';

const dbTest = process.env.DATABASE_URL ? test : test.skip;
const PEPPER = randomBytes(24).toString('hex');
const PW = 'длинный-пароль-1';
const PIN = '80421697';
let phoneSequence = 10;
const testPhone = () => `+3747700${String(phoneSequence++).padStart(4, '0')}`;

async function serve(store) {
  const srv = createServer({ defaultOrgAutoJoin: true, pinPepper: PEPPER, store, trustProxy: true });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: () => new Promise((r) => srv.server.close(r)) };
}

async function call(base, method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function registerByEmail(base, srv, email, nickname) {
  await call(base, 'POST', '/register/email', { body: { email, locale: 'ru' } });
  const code = srv.mailbox(email).filter((m) => m.templateId === 'registration_code').at(-1).text.match(/\b(\d{6})\b/)[1];
  const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code } });
  return call(base, 'POST', '/register', { body: { email, registrationToken: confirmed.body.registrationToken, password: PW, nickname, phone: testPhone(), pin: PIN, pinConfirmation: PIN } });
}

dbTest('SD24: почта, никнейм и поиск переживают перезапуск; уникальность проверяет база', async () => {
  const db = await testDatabase();
  try {
    const first = await serve(createStore({ pool: db.pool, pinPepper: PEPPER }));
    const anna = await registerByEmail(first.base, first.srv, 'anna@example.test', 'Anna.K');
    assert.equal(anna.status, 200);
    await first.stop();

    // Перезапуск: новый процесс сервера над той же базой.
    const second = await serve(createStore({ pool: db.pool, pinPepper: PEPPER }));
    try {
      assert.equal((await registerByEmail(second.base, second.srv, 'boris@example.test', 'anna.k')).status, 409, 'ник занят после перезапуска');
      const boris = await registerByEmail(second.base, second.srv, 'boris@example.test', 'Boris');
      assert.equal(boris.status, 200);
      const login = await call(second.base, 'POST', '/login', { body: { email: 'anna@example.test', password: PW, deviceId: 'ANNA_PHONE' } });
      assert.equal(login.status, 200, 'вход по почте после перезапуска');
      const bLogin = await call(second.base, 'POST', '/login', { body: { email: 'boris@example.test', password: PW, deviceId: 'BORIS_PHONE' } });
      const found = await call(second.base, 'GET', '/users/search?nickname=anna.k', { token: bLogin.body.token });
      assert.equal(found.status, 200);
      assert.equal(found.body.userId, anna.body.userId, 'поиск находит аккаунт после перезапуска');
    } finally {
      await second.stop();
    }

    // Прямой вызов хранилища в обход проверок сервера: уникальность держат индексы базы.
    const direct = createStore({ pool: db.pool, pinPepper: PEPPER });
    assert.equal(await direct.createVerifiedAccount({ userId: 'u-direct-1', passwordHash: 'x', pinHash: await hashPin(PEPPER, PIN), phoneE164: testPhone(), email: 'other@example.test', nickname: 'ANNA.K', nowMs: 0 }), 'nickname');
    assert.equal(await direct.createVerifiedAccount({ userId: 'u-direct-2', passwordHash: 'x', pinHash: await hashPin(PEPPER, PIN), phoneE164: testPhone(), email: 'anna@example.test', nickname: 'Other.One', nowMs: 0 }), 'email');
    assert.equal(await direct.userIdByEmail('anna@example.test'), anna.body.userId, 'отказ не оставил следов в базе');
  } finally {
    await db.close();
  }
});
