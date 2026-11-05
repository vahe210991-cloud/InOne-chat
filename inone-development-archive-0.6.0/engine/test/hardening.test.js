import { randomBytes } from 'node:crypto';
// Исправления версии 0.5.1: C-04 (время ответа на вход), C-07 (история для новых участников),
// C-08 (токены и коды восстановления хранятся на сервере только как хэши).
// Каждый тест должен падать на версии 0.5.0 и проходить на 0.5.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { createVerified } from './recovery-helpers.js';

const ROOM = '!hardening:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const PEPPER = randomBytes(24).toString('hex');
const WRONG = 'совсем-не-пароль-9';

async function start() {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, rateLimits: { registrationsPerAddress: [{ windowMs: 3600000, limit: 1000 }] } });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: () => new Promise((r) => srv.server.close(r)) };
}

async function req(base, method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('C-04: вход с неизвестным логином занимает столько же времени, сколько с неверным паролем', async () => {
  const { base, stop } = await start();
  try {
    const known = Array.from({ length: 12 }, (_, i) => `@known${i}:inone.test`);
    for (const userId of known) {
      assert.equal((await req(base, 'POST', '/register', { body: { userId, password: PW } })).status, 200);
    }
    // Каждый логин получает одну неудачную попытку, поэтому блокировка не срабатывает.
    const timeLogin = async (userId) => {
      const t0 = performance.now();
      const r = await req(base, 'POST', '/login', { body: { userId, password: WRONG, deviceId: 'X', label: 'x', platform: 'test' } });
      const ms = performance.now() - t0;
      assert.equal(r.status, 401);
      return ms;
    };
    await timeLogin('@known-warmup:inone.test');
    const timesKnown = [];
    const timesUnknown = [];
    for (let i = 0; i < known.length; i++) {
      timesKnown.push(await timeLogin(known[i]));
      timesUnknown.push(await timeLogin(`@nobody${i}:inone.test`));
    }
    const mk = median(timesKnown);
    const mu = median(timesUnknown);
    assert.ok(mu >= mk * 0.5,
      `неизвестный логин отвечает слишком быстро: медиана ${mu.toFixed(1)} мс против ${mk.toFixed(1)} мс у существующего`);
  } finally {
    await stop();
  }
});

test('C-07: новый участник не получает события, отправленные до его добавления', async () => {
  const { srv, base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
    for (const c of [alice, bob, carol]) await c.publishKeys();
    await alice.createRoom(ROOM, [ALICE, BOB]);
    await alice.sendText(ROOM, 'до приглашения Carol');
    await alice.addMember(ROOM, CAROL);
    await alice.sendText(ROOM, 'после приглашения Carol');

    const seen = await req(base, 'GET', `/rooms/${encodeURIComponent(ROOM)}/events`, { token: carol.token });
    assert.equal(seen.status, 200);
    const ids = seen.json.events.map((e) => e.event_id);
    const latest = (await srv.roomEvents(ROOM)).at(-1).event_id;
    assert.deepEqual(ids, [latest], 'Carol видит только сообщение, отправленное после её вступления');
  } finally {
    await stop();
  }
});

test('C-08: токен входа хранится на сервере только в виде хэша', async () => {
  const { srv, base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    assert.ok(alice.token, 'токен выдан');
    assert.ok(!(await srv.stateSnapshot()).includes(alice.token), 'открытого токена на сервере быть не должно');
    const still = await req(base, 'GET', '/devices', { token: alice.token });
    assert.equal(still.status, 200, 'токен по-прежнему работает');
  } finally {
    await stop();
  }
});

test('C-08: код восстановления и ссылка хранятся на сервере только как ключевой хэш', async () => {
  const { srv, base, stop } = await start();
  try {
    await createVerified(base, srv, ALICE, 'A_PHONE', PW, '+37477000001');
    assert.equal((await req(base, 'POST', '/recovery/start', { body: { userId: ALICE } })).status, 202);
    const code = srv.smsOutbox('+37477000001').at(-1).text.match(/Код: (\d{6})/)[1];
    const token = srv.mailbox(ALICE).filter((m) => m.subject === 'Подтверждение восстановления').at(-1).text.match(/token=([A-Za-z0-9_-]+)/)[1];
    const snapshot = await srv.stateSnapshot();
    assert.ok(!snapshot.includes(code), 'кода восстановления открытым текстом на сервере быть не должно');
    assert.ok(!snapshot.includes(token), 'ссылки восстановления открытым текстом на сервере быть не должно');
  } finally {
    await stop();
  }
});
