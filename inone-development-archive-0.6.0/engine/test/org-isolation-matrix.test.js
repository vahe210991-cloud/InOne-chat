import { randomBytes } from 'node:crypto';
// Матрица перекрёстной изоляции между организациями (шаг 5.8): посторонняя организация не получает доступа
// к событиям и составу комнаты, не загружает файлы и не создаёт приглашения, не меняет настройки, не читает заявки
// и не видит чужую синхронизацию и устройства. Поиск по нику и выдача ключевых пакетов пропущены: см. причину у каждого.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const ANNA = '@anna-matrix:inone.test';
const BORIS = '@boris-matrix:inone.test';
const CAROL = '@carol-matrix:inone.test';
const DAVE = '@dave-matrix:inone.test';
const ORG_A = 'org-matrix-a';
const ORG_B = 'org-matrix-b';
const ROOM = '!matrix-room:inone.test';
const enc = encodeURIComponent;
const JSON_HEADERS = { 'content-type': 'application/json' };
const SHA = 'c'.repeat(64);

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, docsSecret: 'test-docs-secret-0123456789-abcdefgh' });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const anna = await ChatClient.create(base, ANNA, 'A_PHONE', PW);
  const boris = await ChatClient.create(base, BORIS, 'B_PHONE', PW);
  await store.setNicknameForTests(BORIS, 'borismatrix');
  const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
  await ChatClient.create(base, DAVE, 'D_PHONE', PW);
  await store.createOrganization({ orgId: ORG_A, name: 'Первая', status: 'approved', createdBy: ANNA, createdAt: 1 });
  await store.createOrganization({ orgId: ORG_B, name: 'Вторая', status: 'approved', createdBy: CAROL, createdAt: 2 });
  await store.addOrgMember(ORG_A, ANNA, 'owner', 3);
  await store.addOrgMember(ORG_A, BORIS, 'member', 4);
  await store.addOrgMember(ORG_B, CAROL, 'owner', 5);
  return { srv, base, store, anna, boris, carol, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function call(base, method, p, token, body) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? JSON_HEADERS : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function withRoom(fn) {
  const s = await start();
  try {
    await s.anna.createRoom(ROOM, [ANNA, BORIS], { orgId: ORG_A });
    await fn(s);
  } finally {
    await s.stop();
  }
}

test('комнаты: посторонняя организация не читает события комнаты, и не пишет в неё', async () => {
  await withRoom(async (s) => {
    const mine = await call(s.base, 'GET', `/rooms/${enc(ROOM)}/events`, s.boris.token);
    assert.equal(mine.status, 200, 'контроль: участник комнаты читает события');
    const read = await call(s.base, 'GET', `/rooms/${enc(ROOM)}/events`, s.carol.token);
    assert.ok([403, 404].includes(read.status), 'посторонний не читает события');
    const write = await call(s.base, 'POST', `/rooms/${enc(ROOM)}/events`, s.carol.token, { type: 'm.room.encrypted' });
    assert.equal(write.status, 403, 'запись постороннего отклоняется по членству');
    assert.equal(write.json.error, 'not a member');
  });
});

test('файлы: посторонняя организация не загружает файл в комнату организации', async () => {
  await withRoom(async (s) => {
    const up = await call(s.base, 'POST', '/files', s.carol.token, { kind: 'file', size: 10, sha256: SHA, roomId: ROOM });
    assert.equal(up.status, 403, 'файл в чужую комнату не принимается');
  });
});

test('состав: посторонний не добавляет себя в комнату организации', async () => {
  await withRoom(async (s) => {
    await assert.rejects(s.anna.addMember(ROOM, CAROL), (error) => error.status === 403, 'участник другой организации не добавляется без активной связи через MLS');
  });
});

test('приглашения: посторонний не создаёт приглашение в комнату организации', async () => {
  await withRoom(async (s) => {
    const invite = await call(s.base, 'POST', `/rooms/${enc(ROOM)}/invites`, s.carol.token, {});
    assert.equal(invite.status, 403, 'приглашение в чужую комнату не создаётся');
  });
});

test('настройки: посторонний не меняет настройки чужой организации', async () => {
  await withRoom(async (s) => {
    const change = await call(s.base, 'POST', `/orgs/${ORG_A}/settings`, s.carol.token, { field: 'channelsEnabled', value: false });
    assert.equal(change.status, 403, 'настройки чужой организации не меняются');
    const settings = await call(s.base, 'GET', `/orgs/${ORG_A}/settings`, s.anna.token);
    assert.equal(settings.json.settings.channelsEnabled, true, 'настройки остались прежними');
  });
});

test('заявки: посторонний не читает чужую заявку на создание организации', async () => {
  await withRoom(async (s) => {
    const created = await call(s.base, 'POST', '/org-requests', s.anna.token, { name: 'Частная заявка' });
    assert.equal(created.status, 200);
    const read = await call(s.base, 'GET', `/org-requests/${created.json.requestId}`, s.carol.token);
    assert.equal(read.status, 404, 'чужая заявка не видна');
  });
});

test('синхронизация: посторонний не получает сигналы комнаты организации', async () => {
  await withRoom(async (s) => {
    const sync = await call(s.base, 'GET', '/sync', s.carol.token);
    assert.equal(sync.status, 200);
    assert.ok(!JSON.stringify(sync.json).includes(ROOM), 'в синхронизации посторонней организации комнаты нет');
  });
});

test('устройства: посторонний не видит устройства участника чужой организации', async () => {
  await withRoom(async (s) => {
    const mine = await call(s.base, 'GET', '/devices/mine', s.carol.token);
    assert.equal(mine.status, 200);
    assert.ok(!JSON.stringify(mine.json).includes(BORIS), 'устройства чужого участника не показаны');
  });
});

test('поиск: посторонний не находит участника чужой организации по нику', async () => {
  await withRoom(async (s) => {
    const hidden = await call(s.base, 'GET', '/users/search?nickname=borismatrix', s.carol.token);
    assert.equal(hidden.status, 404, 'посторонний по нику не находит участника чужой организации');
    const shown = await call(s.base, 'GET', '/users/search?nickname=borismatrix', s.anna.token);
    assert.equal(shown.status, 200, 'контроль: участник той же организации находит по нику');
  });
});

test('ключевые пакеты: посторонний не получает ключевые пакеты участника чужой организации', async () => {
  await withRoom(async (s) => {
    await s.boris.raw('POST', '/keys/upload', { one_time_keys: { 'signed_curve25519:m1': { key: 'matrix-key-1' } } });
    const outsider = await s.carol.raw('POST', '/keys/claim', { one_time_keys: { [BORIS]: { 'B_PHONE': 'signed_curve25519' } } });
    assert.deepEqual(outsider.one_time_keys[BORIS] ?? {}, {}, 'посторонний ключи не получает');
    const insider = await s.anna.raw('POST', '/keys/claim', { one_time_keys: { [BORIS]: { 'B_PHONE': 'signed_curve25519' } } });
    assert.ok(Object.keys(insider.one_time_keys[BORIS] ?? {}).length >= 1, 'контроль: участник той же организации получает ключ');
  });
});
