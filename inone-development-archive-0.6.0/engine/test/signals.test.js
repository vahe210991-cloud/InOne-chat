import { randomBytes } from 'node:crypto';
// Сигналы (C-20): уведомления безопасности, изменения состава устройств и бесед не теряются
// после потерянного ответа /sync, а повторные изменения не растят очередь устройства.
// Каждый тест должен падать на версии 0.5.2 и проходить на 0.5.3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';

const ROOM = '!signals:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const PEPPER = randomBytes(24).toString('hex');

async function start() {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER });
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

/** Следующий ответ /sync этого клиента потерян: сервер его отдал, клиент его не получил. */
function dropNextSync(client) {
  const realRaw = client.raw.bind(client);
  let dropped = false;
  client.raw = async (method, path, body) => {
    const res = await realRaw(method, path, body);
    if (!dropped && method === 'GET' && path.startsWith('/sync')) {
      dropped = true;
      throw new Error('соединение оборвалось');
    }
    return res;
  };
}

test('C-20a: уведомление безопасности не теряется после потерянного ответа', async () => {
  const { base, stop } = await start();
  try {
    const phone = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    // Вход с нового устройства: на телефон приходит запрос подтверждения.
    await ChatClient.loginFromNewDevice(base, BOB, PW, 'B_NEW', phone);
    dropNextSync(phone);
    await assert.rejects(phone.sync(), /соединение оборвалось/);
    await phone.sync();
    await phone.sync(); // третья синхронизация не должна повторить уведомление
    const requests = phone.alerts.filter((a) => a.kind === 'device_approval_requested');
    assert.equal(requests.length, 1, 'уведомление пришло ровно один раз');
  } finally {
    await stop();
  }
});

test('C-20b: изменение состава устройств собеседника не теряется после потерянного ответа', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    const seen = [];
    const original = bob.engine.receiveSyncChanges.bind(bob.engine);
    bob.engine.receiveSyncChanges = (json, counts, changed) => {
      seen.push(...changed);
      return original(json, counts, changed);
    };
    // Алиса входит с нового устройства: состав её устройств меняется.
    const aliceNew = await ChatClient.loginFromNewDevice(base, ALICE, PW, 'A_NEW', alice);
    await aliceNew.publishKeys(); // загрузка ключей нового устройства — это и есть изменение состава
    dropNextSync(bob);
    await assert.rejects(bob.sync(), /соединение оборвалось/);
    await bob.sync();
    assert.ok(seen.includes(ALICE), 'Bob узнал о новом устройстве Alice');
  } finally {
    await stop();
  }
});

test('C-20c: изменение состава беседы не теряется после потерянного ответа', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
    for (const c of [alice, bob, carol]) await c.publishKeys();
    await alice.createRoom(ROOM, [ALICE, BOB]);
    await bob.sync(); // Bob узнал о беседе
    await alice.addMember(ROOM, CAROL); // Carol вошла в беседу
    dropNextSync(bob);
    await assert.rejects(bob.sync(), /соединение оборвалось/);
    await bob.sync();
    assert.ok((bob.roomMembers.get(ROOM) ?? []).includes(CAROL), 'Bob узнал о новом участнике');
  } finally {
    await stop();
  }
});

test('C-20d: повторные изменения состава устройств не растят очередь', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    // Каждая загрузка ключей Алисы — изменение состава её устройств.
    for (let i = 0; i < 5; i++) {
      const up = await req(base, 'POST', '/keys/upload', {
        body: { one_time_keys: { [`signed_curve25519:k${i}`]: { key: `v${i}` } } },
        token: alice.token,
      });
      assert.equal(up.status, 200);
    }
    const seen = await req(base, 'GET', '/sync?since=0&signal_since=0', { token: bob.token });
    const items = seen.json.signals.items.filter((x) => x.stream === 'device_list' && x.userId === ALICE);
    assert.equal(items.length, 1, 'одно изменение состава — одна запись в очереди');
  } finally {
    await stop();
  }
});
