import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createMemoryStore } from '../src/store-memory.js';
import { createPushDelivery } from '../src/push-delivery.js';
import { FcmPushError } from '../src/fcm-push-sender.js';
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
const fid = (name) => name.padEnd(22, 'x').slice(0, 22);

function recorder(invalid = new Set()) {
  const sent = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      if (invalid.has(message.fid)) throw new FcmPushError('invalid_target', false);
      return { messageId: `projects/test/messages/${sent.length}` };
    },
  };
}

function memoryPushDelivery(store, sender) {
  const queue = [];
  return {
    encryptRegistrationId(value) { return { fid: value }; },
    async enqueueRoomEvent(_transaction, { roomId, eventId, excludeDeviceKey }) {
      const targets = store.devicesToNotify(roomId, excludeDeviceKey);
      const path = `/rooms/${encodeURIComponent(roomId)}/events/${encodeURIComponent(eventId)}`;
      for (const target of targets) {
        queue.push({ roomId, excludeDeviceKey, deviceKey: target.deviceKey, payload: { type: 'message', event_id: eventId, path } });
      }
      return { queued: targets.length };
    },
    async tick() {
      const pending = queue.splice(0);
      for (const item of pending) {
        const target = store.devicesToNotify(item.roomId, item.excludeDeviceKey).find((x) => x.deviceKey === item.deviceKey);
        if (!target || target.provider !== 'fcm') continue;
        try {
          await sender.send({ fid: target.token.fid, payload: item.payload });
        } catch (error) {
          if (error.code === 'invalid_target') store.deletePushToken(item.deviceKey);
        }
      }
    },
    async stop() {},
  };
}

async function start(sender) {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const pushDelivery = db?.pool
    ? createPushDelivery({ pool: db.pool, sender, encryptionKey: randomBytes(32), pollIntervalMs: 250 })
    : memoryPushDelivery(store, sender);
  if (db?.pool) await pushDelivery.backfillLegacyRegistrations();
  const srv = createServer({
    defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false,
    pinPepper: PEPPER, store, pushDelivery,
  });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
  const bobTab = await ChatClient.loginFromNewDevice(base, BOB, PW, 'B_TAB', bob);
  await alice.createRoom(ROOM, [ALICE, BOB]);
  return {
    srv, base, alice, bob, carol, bobTab, pushDelivery,
    flush: () => pushDelivery.tick(),
    stop: async () => { await new Promise((resolve) => srv.server.close(resolve)); await pushDelivery.stop(); await db?.close(); },
  };
}

async function put(s, client, body) {
  const res = await fetch(`${s.base}/devices/me/push`, { method: 'PUT', headers: { authorization: `Bearer ${client.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function sendMessage(s, text) {
  return s.alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, { message: mlsMessageAt(ROOM, 1, text), kind: 'text', forwarded: false });
}

test('регистрация FID: провайдер и форма проверяются; устройство видит, что push зарегистрирован', async () => {
  const s = await start(recorder());
  try {
    assert.equal((await put(s, s.bob, { provider: 'fcm', token: fid('bob-phone') })).status, 200);
    assert.equal((await put(s, s.bob, { provider: 'fcm', token: 'abcdefghijklmnopqrstuv' })).status, 200);
    assert.equal((await put(s, s.bob, { provider: 'apns', token: fid('bob-tab') })).status, 400, 'iOS uses FCM FID routed through APNs');
    assert.equal((await put(s, s.bob, { provider: 'web', token: fid('bob-tab') })).status, 400, 'unknown provider');
    assert.equal((await put(s, s.bob, { provider: 'fcm', token: 'short' })).status, 400, 'short token');
    assert.equal((await put(s, s.bob, { provider: 'fcm', token: 'bad token with spaces 0000000000000000' })).status, 400, 'token with spaces');
    const list = (await s.bob.raw('GET', '/devices/mine')).devices;
    assert.equal(list.find((d) => d.deviceId === 'B_PHONE').pushRegistered, true);
    assert.equal(list.find((d) => d.deviceId === 'B_TAB').pushRegistered, false);
  } finally {
    await s.stop();
  }
});

test('новое событие ставит минимальные уведомления в очередь для активных устройств участников', async () => {
  const push = recorder();
  const s = await start(push);
  try {
    await put(s, s.alice, { provider: 'fcm', token: fid('alice-phone') });
    await put(s, s.bob, { provider: 'fcm', token: fid('bob-phone') });
    await put(s, s.bobTab, { provider: 'fcm', token: fid('bob-tab') });
    await put(s, s.carol, { provider: 'fcm', token: fid('carol-phone') });
    const sent = await sendMessage(s, 'секрет');
    assert.equal(push.sent.length, 0, 'HTTP request only commits the outbox; sender is not called inline');
    await s.flush();
    const targets = push.sent.map((m) => m.fid).sort();
    assert.deepEqual(targets, [fid('bob-phone'), fid('bob-tab')].sort(), 'only recipient devices are queued');
    for (const m of push.sent) {
      assert.deepEqual(Object.keys(m.payload).sort(), ['event_id', 'path', 'type']);
      assert.equal(m.payload.type, 'message');
      assert.ok(!JSON.stringify(m.payload).includes('секрет'));
      assert.ok(decodeURIComponent(m.payload.path).endsWith(sent.event_id));
    }
  } finally {
    await s.stop();
  }
});

test('отозванное устройство и logout не оставляют будущих отправок', async () => {
  const push = recorder();
  const s = await start(push);
  try {
    await put(s, s.bob, { provider: 'fcm', token: fid('bob-phone') });
    await put(s, s.bobTab, { provider: 'fcm', token: fid('bob-tab') });
    await sendMessage(s, 'до отзыва');
    await s.bob.raw('DELETE', `/devices/${enc('B_TAB')}`);
    await s.flush();
    assert.deepEqual(push.sent.map((m) => m.fid), [fid('bob-phone')], 'revocation cancels the already queued delivery for the revoked device');
    await put(s, s.alice, { provider: 'fcm', token: fid('alice-phone') });
    await s.bob.raw('POST', '/logout', {});
    push.sent.length = 0;
    await sendMessage(s, 'после выхода');
    await s.flush();
    assert.deepEqual(push.sent, [], 'logged-out device is removed from recipient registration');
  } finally {
    await s.stop();
  }
});

test('невалидный FID удаляется только после ответа провайдера и не используется повторно', async () => {
  const bad = fid('bob-old');
  const push = recorder(new Set([bad]));
  const s = await start(push);
  try {
    await put(s, s.bob, { provider: 'fcm', token: bad });
    await sendMessage(s, 'первое');
    await s.flush();
    assert.equal(push.sent.length, 1);
    push.sent.length = 0;
    await sendMessage(s, 'второе');
    await s.flush();
    assert.deepEqual(push.sent, []);
    assert.equal((await s.bob.raw('GET', '/devices/mine')).devices.find((d) => d.deviceId === 'B_PHONE').pushRegistered, false);
  } finally {
    await s.stop();
  }
});
