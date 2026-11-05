import { randomBytes } from 'node:crypto';
// Синхронизация (пункт 7 приоритетов): сигнал о комнате остаётся, пока его не подтвердили; повтор подтверждения безопасен;
// подтверждение номера, которого устройство ещё не получало, не удаляет неполученные сигналы.
// Сигнал о комнате создаёт заметное изменение комнаты (смена названия); фиксация эпохи без состава сигнала не создаёт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!sync:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const enc = encodeURIComponent;

async function call(base, method, p, token) {
  const res = await fetch(base + p, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  await alice.createRoom(ROOM, [ALICE, BOB]);
  let renames = 0;
  const change = async () => alice.raw('PUT', `/rooms/${enc(ROOM)}/name`, { name: `Имя ${++renames}` });
  const sync = (token, signalSince = 0) => call(base, 'GET', `/sync?since=0&signal_since=${signalSince}`, token);
  return { srv, base, alice, bob, change, sync, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

const roomSignals = (res) => res.json.signals.items.filter((i) => i.stream === 'room' && i.roomId === ROOM);

test('сигнал о комнате остаётся, пока его не подтвердили', async () => {
  const s = await start();
  try {
    await s.change();
    const first = await s.sync(s.bob.token);
    assert.equal(roomSignals(first).length, 1, 'сигнал получен');
    const again = await s.sync(s.bob.token);
    assert.equal(roomSignals(again).length, 1, 'без подтверждения сигнал приходит снова, не теряется');
  } finally {
    await s.stop();
  }
});

test('подтверждение убирает сигнал; повтор подтверждения безопасен и ничего не возвращает', async () => {
  const s = await start();
  try {
    await s.change();
    const got = await s.sync(s.bob.token);
    const last = got.json.signals.next_batch;
    const acked = await s.sync(s.bob.token, last);
    assert.equal(acked.status, 200);
    assert.equal(roomSignals(acked).length, 0, 'подтверждённый сигнал убран');
    const repeated = await s.sync(s.bob.token, last);
    assert.equal(repeated.status, 200, 'повтор подтверждения не ломает ответ');
    assert.equal(roomSignals(repeated).length, 0, 'повтор подтверждения ничего не возвращает');
  } finally {
    await s.stop();
  }
});

test('подтверждение номера, которого устройство ещё не получало, не удаляет неполученные сигналы', async () => {
  const s = await start();
  try {
    await s.change();
    const first = await s.sync(s.bob.token);
    assert.equal(roomSignals(first).length, 1, 'первый сигнал получен');
    const acked = await s.sync(s.bob.token, first.json.signals.next_batch); // законное подтверждение: очередь пуста
    assert.equal(roomSignals(acked).length, 0, 'очередь пуста');
    await s.change(); // новое изменение группы: сигнал создан, устройство его ещё не получало
    const sneaky = await s.sync(s.bob.token, 999999); // подтверждение из будущего
    assert.equal(roomSignals(sneaky).length, 1, 'неполученный сигнал не удалён подтверждением из будущего');
  } finally {
    await s.stop();
  }
});
