import { randomBytes } from 'node:crypto';
// Реестр устройств и push-уведомления: токен регистрируется у своего устройства; уведомление получают устройства
// участников, кроме отправившего; отозванное и вышедшее устройство не получают; отвергнутый провайдером токен удаляется.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { mlsMessageAt } from './group-message-helper.mjs';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!push:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const token = (name) => `${name}`.padEnd(40, 'x');

function recorder(invalid = new Set()) {
  const sent = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return invalid.has(message.token) ? { invalidToken: true } : { ok: true };
    },
  };
}

async function start(pushSender) {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store, pushSender });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
  const bobTab = await ChatClient.loginFromNewDevice(base, BOB, PW, 'B_TAB', bob);
  await alice.createRoom(ROOM, [ALICE, BOB]);
  await alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 0, commit: b64('FIRST'), changes: { adds: [], removes: [] } });
  return { srv, base, alice, bob, carol, bobTab, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function put(s, client, body) {
  const res = await fetch(`${s.base}/devices/me/push`, { method: 'PUT', headers: { authorization: `Bearer ${client.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function sendMessage(s, text) {
  return s.alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message: mlsMessageAt(ROOM, 1, text), kind: 'text', forwarded: false });
}

test('регистрация push-токена: провайдер и форма проверяются; устройство видит, что токен есть', async () => {
  const s = await start(recorder());
  try {
    assert.equal((await put(s, s.bob, { provider: 'fcm', token: token('bob-phone') })).status, 200);
    assert.equal((await put(s, s.bob, { provider: 'web', token: token('bob-phone') })).status, 400, 'неизвестный провайдер');
    assert.equal((await put(s, s.bob, { provider: 'fcm', token: 'short' })).status, 400, 'короткий токен');
    assert.equal((await put(s, s.bob, { provider: 'fcm', token: 'bad token with spaces 0000000000000000' })).status, 400, 'токен с пробелами');
    const list = (await s.bob.raw('GET', '/devices/mine')).devices;
    assert.equal(list.find((d) => d.deviceId === 'B_PHONE').pushRegistered, true);
    assert.equal(list.find((d) => d.deviceId === 'B_TAB').pushRegistered, false);
  } finally {
    await s.stop();
  }
});

test('уведомление получают устройства участников, кроме отправившего; содержимого и имени нет', async () => {
  const push = recorder();
  const s = await start(push);
  try {
    await put(s, s.alice, { provider: 'fcm', token: token('alice-phone') });
    await put(s, s.bob, { provider: 'fcm', token: token('bob-phone') });
    await put(s, s.bobTab, { provider: 'apns', token: token('bob-tab') });
    await put(s, s.carol, { provider: 'fcm', token: token('carol-phone') });
    const sent = await sendMessage(s, 'секрет');
    const targets = push.sent.map((m) => m.token).sort();
    assert.deepEqual(targets, [token('bob-phone'), token('bob-tab')].sort(), 'только устройства участника, без отправителя и без чужих');
    for (const m of push.sent) {
      assert.deepEqual(Object.keys(m.payload).sort(), ['path', 'type'], 'в уведомлении только тип и путь');
      assert.equal(m.payload.type, 'message');
      assert.ok(!JSON.stringify(m.payload).includes('секрет'), 'текста в уведомлении нет');
      assert.ok(decodeURIComponent(m.payload.path).endsWith(sent.event_id), 'путь ведёт к событию');
    }
  } finally {
    await s.stop();
  }
});

test('отозванное устройство не получает уведомлений; вышедшее тоже', async () => {
  const push = recorder();
  const s = await start(push);
  try {
    await put(s, s.bob, { provider: 'fcm', token: token('bob-phone') });
    await put(s, s.bobTab, { provider: 'apns', token: token('bob-tab') });
    await s.bob.raw('DELETE', `/devices/${enc('B_TAB')}`);
    push.sent.length = 0;
    await sendMessage(s, 'после отзыва');
    assert.deepEqual(push.sent.map((m) => m.token), [token('bob-phone')], 'отозванный не получает');
    await put(s, s.alice, { provider: 'fcm', token: token('alice-phone') });
    await s.bob.raw('POST', '/logout', {});
    push.sent.length = 0;
    await sendMessage(s, 'после выхода');
    assert.deepEqual(push.sent, [], 'вышедшее устройство и никто больше не получает');
  } finally {
    await s.stop();
  }
});

test('токен, который провайдер отверг, удаляется и больше не используется', async () => {
  const bad = token('bob-old-token');
  const push = recorder(new Set([bad]));
  const s = await start(push);
  try {
    await put(s, s.bob, { provider: 'fcm', token: bad });
    await sendMessage(s, 'первое');
    assert.equal(push.sent.length, 1);
    push.sent.length = 0;
    await sendMessage(s, 'второе');
    assert.deepEqual(push.sent, [], 'отвергнутый токен удалён');
    assert.equal((await s.bob.raw('GET', '/devices/mine')).devices.find((d) => d.deviceId === 'B_PHONE').pushRegistered, false);
  } finally {
    await s.stop();
  }
});
