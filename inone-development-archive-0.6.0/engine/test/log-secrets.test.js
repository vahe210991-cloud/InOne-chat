import { randomBytes } from 'node:crypto';
// Журнал того, что пришло на сервер, не хранит секреты: пароль, токен обновления и токен доступа.
// Журнал — отладочная память сервера; если в нём секрет, его можно вынести через дамп или ошибку.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const FIXTURE_1 = randomBytes(16).toString('hex');
const ALICE = '@alice:inone.test';

test('журнал полученных запросов не содержит пароль, токен обновления и токен доступа', async () => {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const firstRefresh = alice.refreshToken;
    await alice.refreshSession(); // тело этого запроса несёт токен обновления
    const dump = await srv.dump();
    assert.ok(dump.includes('/token/refresh'), 'контроль: запрос обновления попал в журнал');
    assert.ok(!dump.includes(PW), 'пароль не попал в журнал');
    assert.ok(!dump.includes(firstRefresh), 'токен обновления не попал в журнал');
    assert.ok(!dump.includes(alice.token), 'токен доступа не попал в журнал');
  } finally {
    await new Promise((r) => srv.server.close(r));
    await db?.close();
  }
});

test('журнал не хранит почту и телефон, которые пришли в теле запроса', async () => {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    const mail = 'почта.проверка@example.test';
    const phone = '+37400123456';
    await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: ALICE, password: FIXTURE_1, email: mail, phone }) });
    const dump = await srv.dump();
    assert.ok(dump.includes('/login'), 'контроль: запрос попал в журнал');
    assert.ok(!dump.includes(mail), 'почта не попала в журнал');
    assert.ok(!dump.includes(phone), 'телефон не попал в журнал');
  } finally {
    await new Promise((r) => srv.server.close(r));
    await db?.close();
  }
});
