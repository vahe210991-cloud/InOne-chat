import { randomBytes } from 'node:crypto';
// Удалённая конфигурация на сервере: ревизия и кэш, публичная часть без входа, режим обслуживания,
// каналы и размер группы по флагам. Флаги меняются тем же путём, что и командой оператора.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { createMemoryStore } from '../src/store-memory.js';
import { storeForTest } from './helpers.js';
import { mlsMessageAt } from './group-message-helper.mjs';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!config:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const DAVE = '@dave:inone.test';
const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const JSON_HEADERS = { 'content-type': 'application/json' };

async function http(base, method, p, { token, body, headers = {} } = {}) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });
  const buffer = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json };
}

async function start() {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  await ChatClient.create(base, CAROL, 'C_PHONE', PW);
  await ChatClient.create(base, DAVE, 'D_PHONE', PW);
  const flag = (key, value) => store.setFlag(key, value, 'тест', 'проверка флага в тестах', Date.now());
  return { srv, store, base, alice, bob, flag, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('конфигурация: ревизия и ETag; повтор без изменений даёт 304; после изменения приходит новая версия', async () => {
  const s = await start();
  try {
    const first = await http(s.base, 'GET', '/config', { token: s.alice.token });
    assert.equal(first.status, 200);
    assert.equal(first.json.flags['maintenance.enabled'], false);
    const etag = first.headers.get('etag');
    assert.ok(etag, 'есть ETag');
    assert.equal((await http(s.base, 'GET', '/config', { token: s.alice.token, headers: { 'if-none-match': etag } })).status, 304, 'без изменений — 304');
    await s.flag('app.minVersion', '1.2.0');
    const changed = await http(s.base, 'GET', '/config', { token: s.alice.token, headers: { 'if-none-match': etag } });
    assert.equal(changed.status, 200, 'после изменения — новая версия');
    assert.equal(changed.json.flags['app.minVersion'], '1.2.0');
  } finally {
    await s.stop();
  }
});

test('публичная конфигурация: без входа; только статус обслуживания и минимальная версия', async () => {
  const s = await start();
  try {
    const pub = await http(s.base, 'GET', '/config/public');
    assert.equal(pub.status, 200);
    assert.deepEqual(Object.keys(pub.json.flags).sort(), ['app.minVersion', 'maintenance.enabled']);
  } finally {
    await s.stop();
  }
});

test('режим обслуживания: записи и загрузка отключены; чтение и выход работают; после обслуживания всё возвращается', async () => {
  const s = await start();
  try {
    await s.alice.createRoom(ROOM, [ALICE]);
    await s.alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 0, commit: b64('FIRST'), changes: { adds: [], removes: [] } });
    const announced = (await http(s.base, 'POST', '/files', { token: s.alice.token, body: JSON.stringify({ kind: 'avatar', size: 4, sha256: 'b'.repeat(64) }), headers: JSON_HEADERS })).json;
    await s.flag('maintenance.enabled', true);
    const message = JSON.stringify({ message: mlsMessageAt(ROOM, 1, 'текст'), kind: 'text', forwarded: false });
    const blocked = await http(s.base, 'POST', `/mls/groups/${enc(ROOM)}/messages`, { token: s.alice.token, body: message, headers: JSON_HEADERS });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.json.code, 'maintenance');
    const u = new URL(announced.uploadUrl);
    const upload = await http(u.origin, 'PUT', u.pathname + u.search, { body: Buffer.from('abcd'), headers: { 'content-length': '4', 'content-type': 'application/octet-stream' } });
    assert.equal(upload.status, 503, 'загрузка во время обслуживания отключена');
    assert.equal((await http(s.base, 'GET', '/config', { token: s.alice.token })).status, 200, 'чтение работает');
    assert.equal((await http(s.base, 'POST', '/logout', { token: s.alice.token, body: '{}', headers: JSON_HEADERS })).status, 200, 'выход работает');
    await s.flag('maintenance.enabled', false);
    const again = await ChatClient.login(s.base, ALICE, PW, 'A_PHONE');
    assert.equal((await http(s.base, 'POST', `/mls/groups/${enc(ROOM)}/messages`, { token: again.token, body: message, headers: JSON_HEADERS })).status, 200, 'после обслуживания запись проходит');
  } finally {
    await s.stop();
  }
});

test('канал создаётся только при включённом флаге', async () => {
  const s = await start();
  try {
    await s.flag('channels.enabled', false);
    const body = JSON.stringify({ roomId: '!chan-config:inone.test', kind: 'channel', name: 'Новости' });
    const off = await http(s.base, 'POST', '/rooms', { token: s.alice.token, body, headers: JSON_HEADERS });
    assert.equal(off.status, 403);
    assert.equal(off.json.code, 'feature_disabled');
    await s.flag('channels.enabled', true);
    assert.equal((await http(s.base, 'POST', '/rooms', { token: s.alice.token, body, headers: JSON_HEADERS })).status, 200, 'после включения канал создаётся');
  } finally {
    await s.stop();
  }
});

test('размер группы ограничен флагом', async () => {
  const s = await start();
  try {
    await s.alice.createRoom(ROOM, [ALICE, BOB]);
    await s.flag('groups.maxMembers', 3);
    const add = (epoch, user, device) => http(s.base, 'POST', `/mls/groups/${enc(ROOM)}/commits`, {
      token: s.alice.token,
      body: JSON.stringify({ epoch, commit: b64(`ADD-${user}`), changes: { adds: [user], removes: [] }, welcomes: [{ userId: user, deviceId: device, welcome: b64('WELCOME') }] }),
      headers: JSON_HEADERS,
    });
    assert.equal((await add(1, CAROL, 'C_PHONE')).status, 200, 'третий участник в пределах');
    const over = await add(2, DAVE, 'D_PHONE');
    assert.equal(over.status, 409, 'четвёртый сверх предела');
    assert.equal(over.json.error, 'group is full');
  } finally {
    await s.stop();
  }
});
