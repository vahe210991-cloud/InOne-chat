import { randomBytes } from 'node:crypto';
// Доставка с подтверждением (C-05): потерянный ответ не теряет событие, неподтверждённое истекает
// через 30 дней, повтор отправки не создаёт вторую копию, клиент не обрабатывает событие дважды,
// одно непонятное событие не останавливает синхронизацию. Каждый тест должен падать на версии 0.5.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';

const ROOM = '!delivery:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const PEPPER = randomBytes(24).toString('hex');
const DAY = 24 * 60 * 60 * 1000;

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

/** Отправка события доставки с устройства Alice на устройство B_PHONE пользователя Bob. */
const sendToBob = (base, alice, txn, content) =>
  req(base, 'PUT', `/sendToDevice/m.room_key/${txn}`, {
    body: { messages: { [BOB]: { B_PHONE: content } } },
    token: alice.token,
  });

/** Беседа с настоящими ключами: Alice пишет сообщение, и ключ беседы уходит Bob через доставку. */
async function roomWithKeys(base) {
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  for (const c of [alice, bob]) await c.publishKeys();
  await alice.createRoom(ROOM, [ALICE, BOB]);
  await alice.sendText(ROOM, 'секрет для Bob');
  return { alice, bob };
}

test('C-05a: потерянный ответ /sync не теряет событие', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    assert.equal((await sendToBob(base, alice, 'txn-a-1', { marker: 'a-1' })).status, 200);
    const lost = await req(base, 'GET', '/sync', { token: bob.token }); // ответ до клиента не дошёл
    assert.equal(lost.json.to_device.events.length, 1);
    const retry = await req(base, 'GET', '/sync?since=0', { token: bob.token });
    assert.equal(retry.json.to_device.events.length, 1, 'без подтверждения сервер отдаёт событие снова');
    const acked = await req(base, 'GET', `/sync?since=${retry.json.to_device.next_batch}`, { token: bob.token });
    assert.equal(acked.json.to_device.events.length, 0, 'после подтверждения событие удалено');
  } finally {
    await stop();
  }
});

test('C-05b: неподтверждённое событие истекает через 30 дней', async () => {
  const { srv, base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await sendToBob(base, alice, 'txn-b-1', { marker: 'b-1' });
    srv.advance(31 * DAY);
    await bob.renewSession(); // сессия истекла: устройство входит снова, как приложение
    const late = await req(base, 'GET', '/sync', { token: bob.token });
    assert.equal(late.json.to_device.events.length, 0, 'событие старше 30 дней не отдаётся');
  } finally {
    await stop();
  }
});

test('C-05c: повтор отправки с тем же номером не создаёт вторую копию', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    // Ответ на первую отправку потерян, клиент повторяет тот же запрос с тем же номером.
    assert.equal((await sendToBob(base, alice, 'txn-c-1', { marker: 'c-1' })).status, 200);
    assert.equal((await sendToBob(base, alice, 'txn-c-1', { marker: 'c-1' })).status, 200);
    const seen = await req(base, 'GET', '/sync', { token: bob.token });
    const copies = seen.json.to_device.events.filter((e) => e.content.marker === 'c-1');
    assert.equal(copies.length, 1, 'вторая копия не создана');
  } finally {
    await stop();
  }
});

test('C-05d: ключ беседы доходит после потерянного ответа /sync', async () => {
  const { base, stop } = await start();
  try {
    const { bob } = await roomWithKeys(base);
    // Первый ответ /sync до клиента не доходит: сервер уже отдал события, клиент их не получил.
    const realRaw = bob.raw.bind(bob);
    let dropped = false;
    bob.raw = async (method, path, body) => {
      const res = await realRaw(method, path, body);
      if (!dropped && method === 'GET' && path.startsWith('/sync')) {
        dropped = true;
        throw new Error('соединение оборвалось');
      }
      return res;
    };
    await assert.rejects(bob.sync(), /соединение оборвалось/);
    await bob.sync();
    assert.deepEqual(await bob.readText(ROOM), [{ sender: ALICE, body: 'секрет для Bob' }]);
  } finally {
    await stop();
  }
});

test('C-05e: повторно пришедшее событие не обрабатывается дважды', async () => {
  const { base, stop } = await start();
  try {
    const { bob } = await roomWithKeys(base);
    const processed = [];
    const original = bob.engine.receiveSyncChanges.bind(bob.engine);
    bob.engine.receiveSyncChanges = (json, counts, changed) => {
      if (json !== '[]') processed.push(json);
      return original(json, counts, changed);
    };
    const batches = [];
    const realRaw = bob.raw.bind(bob);
    bob.raw = async (method, path, body) => {
      const res = await realRaw(method, path, body);
      if (method === 'GET' && path.startsWith('/sync')) batches.push(res.to_device.events);
      return res;
    };
    await bob.sync();
    assert.ok(processed.length >= 1, 'первая синхронизация обработала события');
    const before = processed.length;
    // Сервер присылает уже обработанную партию повторно (как при потере подтверждения).
    bob.raw = async (method, path, body) => {
      const res = await realRaw(method, path, body);
      if (method === 'GET' && path.startsWith('/sync')) res.to_device.events = batches[0];
      return res;
    };
    await bob.sync();
    assert.equal(processed.length, before, 'повторная партия не обрабатывается второй раз');
    assert.deepEqual(await bob.readText(ROOM), [{ sender: ALICE, body: 'секрет для Bob' }]);
  } finally {
    await stop();
  }
});

test('C-05f: одно непонятное событие не останавливает синхронизацию', async () => {
  const { base, stop } = await start();
  try {
    const { alice, bob } = await roomWithKeys(base);
    // Непонятное событие приходит после настоящих. Движок на него падает.
    assert.equal((await req(base, 'PUT', '/sendToDevice/m.room_key/txn-f-poison', {
      body: { messages: { [BOB]: { B_PHONE: { marker: 'boom' } } } },
      token: alice.token,
    })).status, 200);
    const original = bob.engine.receiveSyncChanges.bind(bob.engine);
    let boomSeen = 0;
    bob.engine.receiveSyncChanges = (json, counts, changed) => {
      if (json.includes('boom')) {
        boomSeen += 1;
        throw new Error('не удалось обработать событие');
      }
      return original(json, counts, changed);
    };
    await bob.sync(); // не должна упасть из-за одного события
    assert.equal(bob.failedEvents.length, 1, 'ошибка записана, а не потеряна');
    await bob.sync(); // непонятное событие уже подтверждено и не приходит снова
    assert.equal(boomSeen, 1, 'непонятное событие не повторяется');
    assert.deepEqual(await bob.readText(ROOM), [{ sender: ALICE, body: 'секрет для Bob' }]);
  } finally {
    await stop();
  }
});

test('C-05g: /sync принимает только числовой номер подтверждения', async () => {
  const { base, stop } = await start();
  try {
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    const bad = await req(base, 'GET', '/sync?since=abc', { token: bob.token });
    assert.equal(bad.status, 400);
  } finally {
    await stop();
  }
});
