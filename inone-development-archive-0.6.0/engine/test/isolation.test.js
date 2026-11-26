import { randomBytes } from 'node:crypto';
// Изоляция данных участников (пункт 2 приоритетов): посторонний не читает, не меняет и не находит чужую комнату,
// её события, состав, приглашения, файлы и устройства. Каждый запрет стоит рядом с контрольным разрешением участнику,
// иначе отказ мог бы значить просто неверный запрос.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { mlsMessageAt } from './group-message-helper.mjs';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!iso:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const JSON_HEADERS = { 'content-type': 'application/json' };

async function http(base, method, p, { token, body, headers = {} } = {}) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

const denied = (res, what) => assert.ok([403, 404].includes(res.status), `${what}: доступ должен быть закрыт, получен ${res.status}`);
const allowed = (res, what) => assert.equal(res.status, 200, `${what}: участнику должно быть разрешено, получен ${res.status}`);

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store, objectSecret: 'test-object-secret-0123456789abcdef' });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
  await alice.createRoom(ROOM, [ALICE, BOB]);
  const sent = await http(base, 'POST', `/mls/groups/${enc(ROOM)}/messages`, { token: alice.token, body: JSON.stringify({ message: mlsMessageAt(ROOM, 1, 'тайна'), kind: 'text', forwarded: false }), headers: JSON_HEADERS });
  assert.equal(sent.status, 200, 'подготовка: участник отправил сообщение');
  return { srv, base, alice, bob, carol, eventId: sent.json.event_id, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('события комнаты: посторонний не читает; участник читает и видит своё сообщение', async () => {
  const s = await start();
  try {
    const mine = await http(s.base, 'GET', `/rooms/${enc(ROOM)}/events`, { token: s.alice.token });
    allowed(mine, 'участник читает события');
    assert.ok(mine.text.includes(s.eventId), 'контроль: сообщение участника видно участнику');
    const theirs = await http(s.base, 'GET', `/rooms/${enc(ROOM)}/events`, { token: s.carol.token });
    denied(theirs, 'посторонний читает события');
    assert.ok(!theirs.text.includes(s.eventId), 'в ответе постороннему нет чужого события');
  } finally {
    await s.stop();
  }
});

test('состояние группы MLS: посторонний не отправляет сообщения и не читает эпоху; участник — может', async () => {
  const s = await start();
  try {
    allowed(await http(s.base, 'GET', `/mls/groups/${enc(ROOM)}/epoch`, { token: s.alice.token }), 'участник читает эпоху');
    denied(await http(s.base, 'GET', `/mls/groups/${enc(ROOM)}/epoch`, { token: s.carol.token }), 'посторонний читает эпоху');
    const intruder = await http(s.base, 'POST', `/mls/groups/${enc(ROOM)}/messages`, { token: s.carol.token, body: JSON.stringify({ message: mlsMessageAt(ROOM, 2, 'вторжение'), kind: 'text', forwarded: false }), headers: JSON_HEADERS });
    denied(intruder, 'посторонний пишет в группу');
  } finally {
    await s.stop();
  }
});

test('состав и название: посторонний не добавляет людей, не переименовывает, не видит состав; участник — может читать состав', async () => {
  const s = await start();
  try {
    allowed(await http(s.base, 'GET', `/rooms/${enc(ROOM)}/members`, { token: s.alice.token }), 'участник читает состав');
    denied(await http(s.base, 'GET', `/rooms/${enc(ROOM)}/members`, { token: s.carol.token }), 'посторонний читает состав');
    denied(await http(s.base, 'POST', `/rooms/${enc(ROOM)}/members`, { token: s.carol.token, body: JSON.stringify({ userId: CAROL }), headers: JSON_HEADERS }), 'посторонний добавляет себя');
    denied(await http(s.base, 'PUT', `/rooms/${enc(ROOM)}/name`, { token: s.carol.token, body: JSON.stringify({ name: 'взлом' }), headers: JSON_HEADERS }), 'посторонний переименовывает');
    denied(await http(s.base, 'POST', `/rooms/${enc(ROOM)}/invites`, { token: s.carol.token, body: '{}', headers: JSON_HEADERS }), 'посторонний создаёт приглашение');
    allowed(await http(s.base, 'POST', `/rooms/${enc(ROOM)}/invites`, { token: s.alice.token, body: '{}', headers: JSON_HEADERS }), 'участник создаёт приглашение');
  } finally {
    await s.stop();
  }
});

test('поиск и синхронизация: посторонний не находит чужую комнату и не получает её события; участник получает', async () => {
  const s = await start();
  try {
    const found = await http(s.base, 'GET', '/rooms/search?q=iso', { token: s.carol.token });
    assert.ok(!found.text.includes(ROOM), 'посторонний не видит комнату в поиске');
    // Синхронизация отдаёт сигналы об изменениях комнат (номера комнат), не сами события.
    const carolSync = await http(s.base, 'GET', '/sync?since=0&signal_since=0', { token: s.carol.token });
    assert.equal(carolSync.status, 200);
    assert.ok(!carolSync.json.rooms.changed.includes(ROOM), 'посторонний не получает сигнала об изменении чужой комнаты');
    assert.ok(!carolSync.text.includes(ROOM), 'в синхронизации постороннего нет имени чужой комнаты');
    const bobSync = await http(s.base, 'GET', '/sync?since=0&signal_since=0', { token: s.bob.token });
    assert.ok(bobSync.json.rooms.changed.includes(ROOM), 'контроль: участник получает сигнал об изменении своей комнаты');
  } finally {
    await s.stop();
  }
});

test('файлы комнаты: посторонний не объявляет файл в комнате и не получает ссылку на чужой файл', async () => {
  const s = await start();
  try {
    const created = await http(s.base, 'POST', '/files', { token: s.alice.token, body: JSON.stringify({ kind: 'file', size: 10, sha256: '0'.repeat(64), roomId: ROOM }), headers: JSON_HEADERS });
    allowed(created, 'участник объявляет файл');
    denied(await http(s.base, 'POST', '/files', { token: s.carol.token, body: JSON.stringify({ kind: 'file', size: 10, sha256: '0'.repeat(64), roomId: ROOM }), headers: JSON_HEADERS }), 'посторонний объявляет файл в чужой комнате');
    denied(await http(s.base, 'GET', `/files/${enc(created.json.fileId)}/url`, { token: s.carol.token }), 'посторонний получает ссылку на чужой файл');
    // Контрольный случай: участник проходит проверку членства (файл ещё не загружен, поэтому отказ по статусу, не по доступу).
    const memberLink = await http(s.base, 'GET', `/files/${enc(created.json.fileId)}/url`, { token: s.alice.token });
    assert.notEqual(memberLink.status, 403, 'контроль: участник проходит проверку членства');
  } finally {
    await s.stop();
  }
});

test('устройства: посторонний не отзывает чужое устройство и не видит чужие устройства; владелец — видит свои', async () => {
  const s = await start();
  try {
    allowed(await http(s.base, 'GET', '/devices/mine', { token: s.bob.token }), 'владелец читает свои устройства');
    const carolDevices = await http(s.base, 'GET', '/devices', { token: s.carol.token });
    assert.ok(!carolDevices.text.includes('B_PHONE'), 'список устройств постороннего не содержит чужих устройств');
    denied(await http(s.base, 'DELETE', `/devices/${enc('B_PHONE')}`, { token: s.carol.token }), 'посторонний отзывает чужое устройство');
    allowed(await http(s.base, 'GET', '/devices/mine', { token: s.bob.token }), 'чужой отзыв не лишил владельца доступа');
  } finally {
    await s.stop();
  }
});
