import { randomBytes } from 'node:crypto';
import { postGroupEvent } from './group-message-helper.mjs';
import { createVerified, startRecovery } from './recovery-helpers.js';
// Сервер на PostgreSQL (версия 0.6.0-alpha.2): аккаунты и PIN хранятся в базе.
// Запуск: DATABASE_URL=... npm run test:db. Без DATABASE_URL тесты пропускаются.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createStore } from '../src/store.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { testDatabase } from './helpers.js';

const dbTest = process.env.DATABASE_URL ? test : test.skip;
const PEPPER = randomBytes(24).toString('hex');
const FIXTURE_1 = randomBytes(16).toString('hex');
const FIXTURE_2 = randomBytes(16).toString('hex');
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const PIN = '246810';

async function start(store) {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, trustProxy: true, trustedProxyIps: ['127.0.0.1'], rateLimits: { registrationsPerAddress: [{ windowMs: 3600000, limit: 1000 }] } });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: () => new Promise((r) => srv.server.close(r)) };
}

async function req(base, method, path, { body, token, headers: extra = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

dbTest('SD1: регистрация и вход по паролю работают с базой', async () => {
  const db = await testDatabase();
  const { base, stop } = await start(createStore({ pool: db.pool, pinPepper: PEPPER }));
  try {
    assert.equal((await req(base, 'POST', '/register', { body: { userId: ALICE, password: PW } })).status, 200);
    assert.equal((await req(base, 'POST', '/register', { body: { userId: ALICE, password: PW } })).status, 409);
    const ok = await req(base, 'POST', '/login', { body: { userId: ALICE, password: PW, deviceId: 'A_PHONE' } });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.token, 'вход по верному паролю выдаёт токен');
    const bad = await req(base, 'POST', '/login', { body: { userId: ALICE, password: FIXTURE_1, deviceId: 'A_PHONE' } });
    assert.equal(bad.status, 401);
  } finally {
    await stop();
    await db.close();
  }
});

dbTest('SD2: параллельная регистрация одного логина: одна удача, остальные 409, ошибок нет', async () => {
  const db = await testDatabase();
  const { base, stop } = await start(createStore({ pool: db.pool, pinPepper: PEPPER }));
  try {
    const statuses = await Promise.all(Array.from({ length: 20 }, () =>
      req(base, 'POST', '/register', { body: { userId: ALICE, password: PW } }).then((r) => r.status)));
    assert.equal(statuses.filter((s) => s === 200).length, 1, 'зарегистрирован ровно один раз');
    assert.equal(statuses.filter((s) => s === 409).length, 19, 'остальные получили 409');
    assert.equal(statuses.filter((s) => s >= 500).length, 0, 'ошибок сервера быть не должно');
  } finally {
    await stop();
    await db.close();
  }
});

dbTest('SD3: PIN задаётся, проверяется и снимается через базу', async () => {
  const db = await testDatabase();
  const { base, stop } = await start(createStore({ pool: db.pool, pinPepper: PEPPER }));
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await alice.setPin(PIN);
    await assert.rejects(alice.removePin('111111'), (e) => e.status === 403, 'неверный PIN не снимает защиту');
    await alice.removePin(PIN);
    await assert.rejects(alice.removePin(PIN), (e) => e.status === 404, 'после снятия PIN нет');
  } finally {
    await stop();
    await db.close();
  }
});

dbTest('SD4: параллельный перебор PIN по HTTP на базе: не больше пяти реальных проверок', async () => {
  const db = await testDatabase();
  const { srv, base, stop } = await start(createStore({ pool: db.pool, pinPepper: PEPPER }));
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await alice.setPin(PIN);
    const statuses = await Promise.all(Array.from({ length: 40 }, (_, i) =>
      req(base, 'POST', '/pin/remove', { body: { currentPin: String(100_000 + i) }, token: alice.token }).then((r) => r.status)));
    assert.equal(srv.pinChecks(), 5, 'реальных проверок PIN не больше пяти');
    assert.equal(statuses.filter((s) => s === 403).length, 5, 'пять неверных ответов');
    assert.equal(statuses.filter((s) => s === 429).length, 35, 'остальные отклонены блокировкой');
    assert.equal(statuses.filter((s) => s >= 500).length, 0, 'ошибок сервера быть не должно');
  } finally {
    await stop();
    await db.close();
  }
});

dbTest('SD5: блокировка PIN переживает перезапуск сервера', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const first = await start(store);
  try {
    const alice = await ChatClient.create(first.base, ALICE, 'A_PHONE', PW);
    await alice.setPin(PIN);
    for (let i = 0; i < 5; i++) {
      await assert.rejects(alice.removePin(String(100_000 + i)), (e) => e.status === 403);
    }
  } finally {
    await first.stop();
  }
  const second = await start(store);
  try {
    const again = await ChatClient.login(second.base, ALICE, PW, 'A_PHONE');
    await assert.rejects(again.removePin(PIN), (e) => e.status === 429, 'после перезапуска верный PIN всё ещё заблокирован');
    assert.equal(second.srv.pinChecks(), 0, 'после перезапуска проверок не было');
  } finally {
    await second.stop();
    await db.close();
  }
});

dbTest('SD6: токен входа переживает перезапуск сервера: устройство хранится в базе', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const first = await start(store);
  let token;
  try {
    const alice = await ChatClient.create(first.base, ALICE, 'A_PHONE', PW);
    token = alice.token;
    assert.equal((await req(first.base, 'GET', '/devices', { token })).status, 200);
  } finally {
    await first.stop();
  }
  const second = await start(store);
  try {
    const again = await req(second.base, 'GET', '/devices', { token });
    assert.equal(again.status, 200, 'старый токен работает на новом сервере');
    assert.equal(again.json.devices.length, 1, 'устройство на месте');
  } finally {
    await second.stop();
    await db.close();
  }
});

dbTest('SD7: отозванное устройство не работает после перезапуска сервера', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const first = await start(store);
  let phoneToken, laptopToken;
  try {
    const phone = await ChatClient.create(first.base, ALICE, 'A_PHONE', PW);
    phoneToken = phone.token;
    const laptop = await ChatClient.loginFromNewDevice(first.base, ALICE, PW, 'B_LAPTOP', phone);
    laptopToken = laptop.token;
    assert.equal((await req(first.base, 'DELETE', '/devices/A_PHONE', { token: laptopToken })).status, 200, 'ноутбук отзывает телефон');
  } finally {
    await first.stop();
  }
  const second = await start(store);
  try {
    assert.equal((await req(second.base, 'GET', '/devices', { token: phoneToken })).status, 401, 'отозванный телефон отклонён');
    assert.equal((await req(second.base, 'GET', '/devices', { token: laptopToken })).status, 200, 'ноутбук работает');
  } finally {
    await second.stop();
    await db.close();
  }
});

dbTest('SD8: после перезапуска сервер помнит активные устройства: новый вход ждёт подтверждения', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const first = await start(store);
  try {
    await ChatClient.create(first.base, ALICE, 'A_PHONE', PW);
  } finally {
    await first.stop();
  }
  const second = await start(store);
  try {
    const r = await req(second.base, 'POST', '/login', { body: { userId: ALICE, password: PW, deviceId: 'B_LAPTOP', label: 'laptop', platform: 'test' } });
    assert.equal(r.status, 202, 'новое устройство ждёт подтверждения с активного телефона');
    assert.equal(r.json.status, 'approval_required');
  } finally {
    await second.stop();
    await db.close();
  }
});

dbTest('SD9: один запрос подтверждения даёт один токен, даже при параллельных запросах получения', async () => {
  const db = await testDatabase();
  const { base, stop } = await start(createStore({ pool: db.pool, pinPepper: PEPPER }));
  try {
    const phone = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const pending = await req(base, 'POST', '/login', { body: { userId: ALICE, password: PW, deviceId: 'B_LAPTOP', label: 'laptop', platform: 'test' } });
    assert.equal(pending.status, 202);
    const { approvalId, code, pollSecret } = pending.json;
    assert.equal((await req(base, 'POST', `/approvals/${approvalId}/approve`, { body: { code }, token: phone.token })).status, 200);
    const claims = await Promise.all(Array.from({ length: 10 }, () =>
      req(base, 'POST', `/approvals/${approvalId}/claim`, { body: { pollSecret } })));
    assert.equal(claims.filter((r) => r.status === 200 && r.json.status === 'approved' && r.json.token).length, 1, 'токен выдан ровно один раз');
    assert.equal(claims.filter((r) => r.status === 404).length, 9, 'остальные запросы получили 404');
  } finally {
    await stop();
    await db.close();
  }
});

dbTest('SD10: перебор пароля с одного адреса: три неверных ответа, затем задержка', async () => {
  const db = await testDatabase();
  const { base, stop } = await start(createStore({ pool: db.pool, pinPepper: PEPPER }));
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const statuses = await Promise.all(Array.from({ length: 40 }, (_, i) =>
      req(base, 'POST', '/login', {
        body: { userId: ALICE, password: `неверный-пароль-${i}`, deviceId: 'A_PHONE' },
        headers: { 'x-forwarded-for': '203.0.113.9' },
      }).then((r) => r.status)));
    assert.equal(statuses.filter((s) => s === 401).length, 3, 'три неверных ответа');
    assert.equal(statuses.filter((s) => s === 429).length, 37, 'остальные ждут задержки');
    assert.equal(statuses.filter((s) => s >= 500).length, 0, 'ошибок сервера быть не должно');
  } finally {
    await stop();
    await db.close();
  }
});

dbTest('SD13: блокировка адреса не закрывает вход владельцу с другого адреса', async () => {
  const db = await testDatabase();
  const { base, stop } = await start(createStore({ pool: db.pool, pinPepper: PEPPER }));
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const attempt = (ip, password) => req(base, 'POST', '/login', {
      body: { userId: ALICE, password, deviceId: 'A_PHONE' },
      headers: { 'x-forwarded-for': ip },
    });
    for (let i = 0; i < 3; i++) assert.equal((await attempt('203.0.113.9', `неверный-${i}`)).status, 401);
    assert.equal((await attempt('203.0.113.9', PW)).status, 429, 'атакующий адрес ждёт, даже с верным паролем');
    assert.equal((await attempt('198.51.100.20', PW)).status, 200, 'владелец с другого адреса входит');
  } finally {
    await stop();
    await db.close();
  }
});

dbTest('SD14: после нескольких неудач владелец получает уведомление, даже если атаки идут с разных адресов', async () => {
  const db = await testDatabase();
  const { base, stop } = await start(createStore({ pool: db.pool, pinPepper: PEPPER }));
  try {
    const phone = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    for (let i = 0; i < 5; i++) {
      const r = await req(base, 'POST', '/login', {
        body: { userId: ALICE, password: `неверный-${i}`, deviceId: 'A_PHONE' },
        headers: { 'x-forwarded-for': `198.51.100.${10 + i}` },
      });
      assert.equal(r.status, 401);
    }
    await phone.sync();
    assert.ok(phone.alerts.some((a) => a.kind === 'login_failures'), 'владелец получил уведомление');
    assert.equal((await req(base, 'POST', '/login', { body: { userId: ALICE, password: PW, deviceId: 'A_PHONE' } })).status, 200, 'вход не заблокирован');
  } finally {
    await stop();
    await db.close();
  }
});

dbTest('SD11: параллельный перебор кода подтверждения: три неверных ответа, потом запрос закрыт', async () => {
  const db = await testDatabase();
  const { base, stop } = await start(createStore({ pool: db.pool, pinPepper: PEPPER }));
  try {
    const phone = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const pending = await req(base, 'POST', '/login', { body: { userId: ALICE, password: PW, deviceId: 'B_LAPTOP', label: 'laptop', platform: 'test' } });
    assert.equal(pending.status, 202);
    const statuses = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      req(base, 'POST', `/approvals/${pending.json.approvalId}/approve`, { body: { code: String(100_000 + i) }, token: phone.token }).then((r) => r.status)));
    assert.equal(statuses.filter((s) => s === 403).length, 3, 'три неверных ответа');
    assert.equal(statuses.filter((s) => s === 404).length, 17, 'остальные: запрос уже закрыт');
    assert.equal(statuses.filter((s) => s >= 500).length, 0, 'ошибок сервера быть не должно');
  } finally {
    await stop();
    await db.close();
  }
});

dbTest('SD12: запрос подтверждения переживает перезапуск сервера и подтверждается на новом сервере', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const first = await start(store);
  let phone, pending;
  try {
    phone = await ChatClient.create(first.base, ALICE, 'A_PHONE', PW);
    const r = await req(first.base, 'POST', '/login', { body: { userId: ALICE, password: PW, deviceId: 'B_LAPTOP', label: 'laptop', platform: 'test' } });
    assert.equal(r.status, 202);
    pending = r.json;
  } finally {
    await first.stop();
  }
  const second = await start(store);
  try {
    const list = await req(second.base, 'GET', '/approvals', { token: phone.token });
    assert.equal(list.status, 200);
    assert.equal(list.json.approvals.length, 1, 'запрос виден после перезапуска');
    assert.equal((await req(second.base, 'POST', `/approvals/${pending.approvalId}/approve`, { body: { code: pending.code }, token: phone.token })).status, 200);
    const got = await req(second.base, 'POST', `/approvals/${pending.approvalId}/claim`, { body: { pollSecret: pending.pollSecret } });
    assert.equal(got.status, 200);
    assert.equal(got.json.status, 'approved');
    assert.ok(got.json.token, 'новое устройство получило токен');
  } finally {
    await second.stop();
    await db.close();
  }
});

dbTest('SD15: перебор разных логинов с одного адреса: после тридцати неудач адрес ждёт', async () => {
  const db = await testDatabase();
  const { base, stop } = await start(createStore({ pool: db.pool, pinPepper: PEPPER }));
  try {
    const statuses = [];
    for (let i = 0; i < 40; i++) {
      const r = await req(base, 'POST', '/login', {
        body: { userId: `@nobody${i}:inone.test`, password: FIXTURE_2 },
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });
      statuses.push(r.status);
    }
    assert.deepEqual(statuses.slice(0, 30), Array(30).fill(401), 'первые тридцать неудач — обычный ответ');
    assert.deepEqual(statuses.slice(30), Array(10).fill(429), 'дальше адрес ограничен');
  } finally {
    await stop();
    await db.close();
  }
});

dbTest('SD16: новый пароль и время создания устройства сохраняются в базе', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  try {
    await store.addAccount(ALICE, 'хэш-старый');
    await store.setPasswordHash(ALICE, 'хэш-новый');
    assert.equal(await store.accountHash(ALICE), 'хэш-новый', 'пароль заменён в базе');
    await store.addDevice(ALICE, 'A_PHONE', 'телефон', 1234567);
    assert.equal((await store.deviceRecord(`${ALICE}|A_PHONE`)).createdAt, 1234567, 'время создания сохранено');
  } finally {
    await db.close();
  }
});

async function startOn(store) {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, trustProxy: true, rateLimits: { registrationsPerAddress: [{ windowMs: 3600000, limit: 1000 }] } });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: () => new Promise((r) => srv.server.close(r)) };
}

const recoveryCode = (srv, userId) =>
  srv.mailbox(userId).filter((m) => /\b\d{6}\b/.test(m.text)).at(-1).text.match(/\b(\d{6})\b/)[1];

dbTest('SD17: окно восстановления переживает перезапуск сервера: устройства по-прежнему только читают', async () => {
  const NEW_PW = 'новый-пароль-2026';
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  let first = null;
  let second = null;
  try {
    first = await startOn(store);
    const phone = await createVerified(first.base, first.srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const smsCode = await startRecovery(first.base, first.srv, ALICE, PHONE_A);
    await req(first.base, 'POST', '/recovery/complete', { body: { userId: ALICE, code: smsCode, newPassword: NEW_PW } });
    await first.stop(); // перезапуск: сервер новый, база та же
    first = null;
    second = await startOn(store);
    phone.baseUrl = second.base;
    await assert.rejects(phone.raw('POST', '/pin/set', { pin: '246810' }), (e) => e.status === 403, 'после перезапуска окно действует');
    await phone.raw('POST', '/recovery/cancel'); // старое устройство отменяет восстановление
    assert.equal((await req(second.base, 'POST', '/login', { body: { userId: ALICE, password: PW, deviceId: 'A_PHONE' } })).status, 200);
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    await db.close();
  }
});

dbTest('SD18: после перезапуска окно закрывается и старые устройства отключаются', async () => {
  const NEW_PW = 'новый-пароль-2026';
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  let first = null;
  let second = null;
  try {
    first = await startOn(store);
    const phone = await createVerified(first.base, first.srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const smsCode = await startRecovery(first.base, first.srv, ALICE, PHONE_A);
    await req(first.base, 'POST', '/recovery/complete', { body: { userId: ALICE, code: smsCode, newPassword: NEW_PW } });
    await first.stop();
    first = null;
    second = await startOn(store);
    second.srv.advance(48 * 60 * 60 * 1000 + 1000);
    phone.baseUrl = second.base;
    await assert.rejects(phone.sync(), (e) => e.status === 401, 'старое устройство отключено после окна');
    assert.ok(second.srv.mailbox(ALICE).some((m) => m.templateId === 'old_devices_revoked'));
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    await db.close();
  }
});

dbTest('SD19: беседа, участники и история переживают перезапуск сервера; вступивший позже не видит прошлого', async () => {
  const BOB_ID = '@bob:inone.test';
  const CAROL_ID = '@carol:inone.test';
  const ROOM_ID = '!restart-room:inone.test';
  const enc = encodeURIComponent(ROOM_ID);
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  let first = null;
  let second = null;
  try {
    first = await startOn(store);
    const alice = await ChatClient.create(first.base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(first.base, BOB_ID, 'B_PHONE', PW);
    await alice.createRoom(ROOM_ID, [ALICE, BOB_ID]);
    const before = await postGroupEvent(alice, decodeURIComponent(enc), { type: 'm.room.encrypted', content: { c: 'до перезапуска' } });
    await first.stop();
    first = null;
    second = await startOn(store);
    alice.baseUrl = second.base;
    bob.baseUrl = second.base;
    const seen = await bob.raw('GET', `/rooms/${enc}/events`);
    assert.deepEqual(seen.events.map((e) => e.content.mls), [before.message], 'история сохранилась');
    const members = await alice.raw('GET', `/rooms/${enc}/members`);
    assert.deepEqual([...members.members].sort(), [ALICE, BOB_ID].sort(), 'участники сохранились');
    // Вступивший после перезапуска не видит того, что было раньше (C-07).
    const carol = await ChatClient.create(second.base, CAROL_ID, 'C_PHONE', PW);
    await alice.addMember(ROOM_ID, CAROL_ID);
    assert.deepEqual((await carol.raw('GET', `/rooms/${enc}/events`)).events, [], 'прошлое новичку не отдаётся');
    const after = await postGroupEvent(alice, decodeURIComponent(enc), { type: 'm.room.encrypted', content: { c: 'после' } });
    assert.deepEqual((await carol.raw('GET', `/rooms/${enc}/events`)).events.map((e) => e.content.mls), [after.message]);
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    await db.close();
  }
});

dbTest('SD20: ключи устройства и одноразовые ключи переживают перезапуск; одноразовый ключ выдаётся один раз', async () => {
  const BOB_ID = '@bob:inone.test';
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  let first = null;
  let second = null;
  try {
    first = await startOn(store);
    const alice = await ChatClient.create(first.base, ALICE, 'A_PHONE', PW);
    await alice.publishKeys(); // ключи устройства публикуются явно, как во всех тестах шифрования
    // Одноразовые ключи загружает само устройство: три ключа, чтобы было что выдавать.
    await alice.raw('POST', '/keys/upload', { one_time_keys: {
      'signed_curve25519:otk1': { key: 'AAAA' }, 'signed_curve25519:otk2': { key: 'BBBB' }, 'signed_curve25519:otk3': { key: 'CCCC' },
    } });
    const before = (await alice.raw('GET', '/sync?since=0&signal_since=0')).device_one_time_keys_count.signed_curve25519;
    assert.ok(before >= 2, 'у устройства есть одноразовые ключи');
    const bob = await ChatClient.create(first.base, BOB_ID, 'B_PHONE', PW);
    await first.stop();
    first = null;
    second = await startOn(store);
    alice.baseUrl = second.base;
    bob.baseUrl = second.base;
    const keys = await bob.raw('POST', '/keys/query', { device_keys: { [ALICE]: [] } });
    assert.ok(keys.device_keys[ALICE].A_PHONE, 'ключи устройства сохранились');
    const claim1 = await bob.raw('POST', '/keys/claim', { one_time_keys: { [ALICE]: { A_PHONE: 'signed_curve25519' } } });
    const claim2 = await bob.raw('POST', '/keys/claim', { one_time_keys: { [ALICE]: { A_PHONE: 'signed_curve25519' } } });
    const name1 = Object.keys(claim1.one_time_keys[ALICE].A_PHONE)[0];
    const name2 = Object.keys(claim2.one_time_keys[ALICE].A_PHONE)[0];
    assert.notEqual(name1, name2, 'один и тот же одноразовый ключ дважды не выдаётся');
    const after = (await alice.raw('GET', '/sync?since=0&signal_since=0')).device_one_time_keys_count.signed_curve25519;
    assert.equal(after, before - 2, 'счётчик одноразовых ключей сохранился');
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    await db.close();
  }
});

dbTest('SD21: очередь доставки переживает перезапуск; подтверждённое не отдаётся снова; повтор отправки не дублирует', async () => {
  const BOB_ID = '@bob:inone.test';
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  let first = null;
  let second = null;
  try {
    first = await startOn(store);
    const alice = await ChatClient.create(first.base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(first.base, BOB_ID, 'B_PHONE', PW);
    await alice.raw('PUT', '/sendToDevice/m.test/txn-1', { messages: { [BOB_ID]: { B_PHONE: { hello: 'до перезапуска' } } } });
    await first.stop();
    first = null;
    second = await startOn(store);
    alice.baseUrl = second.base;
    bob.baseUrl = second.base;
    const firstSync = await bob.raw('GET', '/sync?since=0&signal_since=0');
    assert.deepEqual(firstSync.to_device.events.map((e) => e.content.hello), ['до перезапуска'], 'событие доставлено после перезапуска');
    // Повтор той же отправки после перезапуска не создаёт второй копии; подтверждённое не отдаётся снова.
    await alice.raw('PUT', '/sendToDevice/m.test/txn-1', { messages: { [BOB_ID]: { B_PHONE: { hello: 'дубль' } } } });
    const again = await bob.raw('GET', `/sync?since=${firstSync.to_device.next_batch}&signal_since=${firstSync.signals.next_batch}`);
    assert.deepEqual(again.to_device.events, [], 'повтор не дублирует, подтверждённое не отдаётся снова');
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    await db.close();
  }
});

const PHONE_A = '+37477000001';

dbTest('SD22: один подтверждённый телефон не принадлежит двум аккаунтам и на базе', async () => {
  const BOB_ID = '@bob:inone.test';
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  let server = null;
  try {
    server = await startOn(store);
    await createVerified(server.base, server.srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const reg = await fetch(`${server.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: BOB_ID, password: PW, phone: PHONE_A }) });
    assert.equal(reg.status, 409, 'регистрация с занятым номером отклоняется');
    const bob = await ChatClient.create(server.base, BOB_ID, 'B_PHONE', PW);
    await assert.rejects(bob.raw('POST', '/account/phone', { password: PW, phone: PHONE_A }), (e) => e.status === 409, 'занятый номер не принимается даже для SMS');
  } finally {
    if (server) await server.stop();
    await db.close();
  }
});

dbTest('SD23: счётчики регистраций переживают перезапуск сервера', async () => {
  const LIMITS = { registrationsPerAddress: [{ windowMs: 60 * 60 * 1000, limit: 2 }] };
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const serve = async () => {
    const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, trustProxy: true, rateLimits: LIMITS });
    await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
    return { srv, base: `http://127.0.0.1:${srv.server.address().port}`, stop: () => new Promise((r) => srv.server.close(r)) };
  };
  let first = null;
  let second = null;
  try {
    first = await serve();
    await ChatClient.create(first.base, '@e1:inone.test', 'E1', PW);
    await ChatClient.create(first.base, '@e2:inone.test', 'E2', PW);
    await first.stop();
    first = null;
    second = await serve();
    await assert.rejects(ChatClient.create(second.base, '@e3:inone.test', 'E3', PW), (e) => e.status === 429, 'после перезапуска лимит на месте');
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    await db.close();
  }
});


dbTest('SD KeyPackage claim: replay after restart returns the same durable result', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  let firstServer = await start(store);
  let alice;
  let bob;
  let first;
  const claimId = 'claim-intent-pg-restart-0001';
  const claimPath = `/mls/key-packages/${encodeURIComponent(ALICE)}/claim`;
  try {
    alice = await ChatClient.create(firstServer.base, ALICE, 'A_PHONE', PW);
    bob = await ChatClient.create(firstServer.base, BOB, 'B_PHONE', PW);
    await alice.raw('POST', '/mls/key-packages', { packages: [Buffer.from('pg-key-package-1').toString('base64'), Buffer.from('pg-key-package-2').toString('base64')] });
    first = await bob.raw('POST', claimPath, { claimId });
    assert.equal(first.packages.length, 1);
    assert.equal((await alice.raw('GET', '/mls/key-packages/count')).available, 1);
  } finally {
    await firstServer.stop();
  }

  const secondServer = await start(store);
  try {
    const replayResponse = await req(secondServer.base, 'POST', claimPath, { body: { claimId }, token: bob.token });
    assert.equal(replayResponse.status, 200);
    const replay = replayResponse.json;
    assert.deepEqual(replay, first, 'claim result survives server restart and replays byte-for-byte');
    assert.equal((await req(secondServer.base, 'GET', '/mls/key-packages/count', { token: alice.token })).json.available, 1, 'replay does not consume a second KeyPackage');
    const nextResponse = await req(secondServer.base, 'POST', claimPath, { body: { claimId: 'claim-intent-pg-next-0002' }, token: bob.token });
    assert.equal(nextResponse.status, 200);
    const next = nextResponse.json;
    assert.equal(next.packages.length, 1);
    assert.notEqual(next.packages[0].package, first.packages[0].package);
    assert.equal((await req(secondServer.base, 'GET', '/mls/key-packages/count', { token: alice.token })).json.available, 0);
  } finally {
    await secondServer.stop();
    await db.close();
  }
});

dbTest('SD17: неожиданные внутренние ошибки не раскрывают детали HTTP-клиенту', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const logs = [];
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error: (message, fields) => logs.push({ message, ...fields }),
  };
  const srv = createServer({
    registrationMode: 'open',
    requirePhone: false,
    pinPepper: PEPPER,
    store,
    logger,
  });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    const client = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const secretDetail = 'postgres-internal-host-and-query-detail';
    store.profileGet = async () => {
      throw Object.assign(new Error(secretDetail), { code: 'XX000' });
    };
    const response = await req(base, 'GET', '/profile', { token: client.token });
    assert.equal(response.status, 500);
    assert.deepEqual(response.json, { error: 'internal server error' });
    assert.ok(!JSON.stringify(logs).includes(secretDetail));
    assert.equal(logs.at(-1)?.errorCode, 'XX000');
  } finally {
    await new Promise((resolve) => srv.server.close(resolve));
    await db.close();
  }
});
