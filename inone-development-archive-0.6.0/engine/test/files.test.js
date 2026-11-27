// Загрузка файлов: подписанные адреса, проверка размера и контрольной суммы, доступ только членам комнаты,
// прикрепление только готового файла, лимит незавершённых загрузок, очистка брошенных загрузок.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { request as nodeRequest } from 'node:http';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';
import { mlsMessageAt } from './group-message-helper.mjs';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!files:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const MIN = 60_000;
const DAY = 24 * 3600_000;
const enc = encodeURIComponent;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

async function http(base, method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });
  const buffer = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, buffer, json };
}

const jsonBody = (value) => JSON.stringify(value);
const JSON_HEADERS = { 'content-type': 'application/json' };

async function start({ quotaBytes = null, objectStore = null } = {}) {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store, objectSecret: 'test-object-secret-0123456789abcdef', quotaBytes, objectStore });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  const carol = await ChatClient.create(base, CAROL, 'C_PHONE', PW);
  await alice.createRoom(ROOM, [ALICE, BOB]);
  await alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 0, commit: b64('FIRST'), changes: { adds: [], removes: [] } });
  return { srv, store, base, alice, bob, carol, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

async function announce(s, token, bytes, { roomId = ROOM, kind = 'file', declaredSize = bytes.length, declaredSha = sha(bytes) } = {}) {
  const body = { kind, size: declaredSize, sha256: declaredSha };
  if (roomId !== undefined) body.roomId = roomId;
  return http(s.base, 'POST', '/files', { token, body: jsonBody(body), headers: JSON_HEADERS });
}

async function putTo(url, bytes) {
  const u = new URL(url);
  return http(u.origin, 'PUT', u.pathname + u.search, { body: bytes, headers: { 'content-length': String(bytes.length), 'content-type': 'application/octet-stream' } });
}

async function completeFile(s, token, fileId) {
  return http(s.base, 'POST', `/files/${enc(fileId)}/complete`, { token, body: '{}', headers: JSON_HEADERS });
}

async function uploadReady(s, token, bytes, options) {
  const created = (await announce(s, token, bytes, options)).json;
  assert.ok(created, 'загрузка объявлена');
  assert.equal((await putTo(created.uploadUrl, bytes)).status, 200);
  assert.equal((await completeFile(s, token, created.fileId)).status, 200);
  return created.fileId;
}

test('ссылка скачивания привязана к активному устройству и текущему членству в комнате', async () => {
  const s = await start();
  try {
    const fileId = await uploadReady(s, s.alice.token, randomBytes(400));

    const bobOld = await ChatClient.loginFromNewDevice(s.base, BOB, PW, 'B_OLD', s.bob);
    const oldDeviceLink = (await http(s.base, 'GET', `/files/${enc(fileId)}/url`, { token: bobOld.token })).json;
    const oldDeviceUrl = new URL(oldDeviceLink.downloadUrl);

    assert.equal((await http(oldDeviceUrl.origin, 'GET', oldDeviceUrl.pathname + oldDeviceUrl.search)).status, 401,
      'signed URL without an active session must not grant access');
    assert.equal((await http(oldDeviceUrl.origin, 'GET', oldDeviceUrl.pathname + oldDeviceUrl.search, { token: s.bob.token })).status, 403,
      'URL must not work with another device token');
    assert.equal((await http(oldDeviceUrl.origin, 'GET', oldDeviceUrl.pathname + oldDeviceUrl.search, { token: bobOld.token })).status, 200,
      'URL works only with the issuing active device');

    await s.bob.raw('DELETE', `/devices/${enc('B_OLD')}`);
    assert.equal((await http(oldDeviceUrl.origin, 'GET', oldDeviceUrl.pathname + oldDeviceUrl.search, { token: bobOld.token })).status, 401,
      'revocation immediately invalidates an already-issued URL');

    const currentDeviceLink = (await http(s.base, 'GET', `/files/${enc(fileId)}/url`, { token: s.bob.token })).json;
    const currentDeviceUrl = new URL(currentDeviceLink.downloadUrl);
    assert.equal((await http(currentDeviceUrl.origin, 'GET', currentDeviceUrl.pathname + currentDeviceUrl.search, { token: s.bob.token })).status, 200);

    await s.alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
      epoch: 1, commit: b64('REMOVE-BOB-FILE-DOWNLOAD'),
      changes: { adds: [], removes: [BOB] },
    });
    assert.equal((await http(currentDeviceUrl.origin, 'GET', currentDeviceUrl.pathname + currentDeviceUrl.search, { token: s.bob.token })).status, 403,
      'removing a room member immediately invalidates an already-issued URL');
  } finally {
    await s.stop();
  }
});

test('полный путь: загрузка по подписанному адресу, подтверждение, скачивание по ссылке', async () => {
  const s = await start();
  try {
    const bytes = randomBytes(1000);
    const created = (await announce(s, s.alice.token, bytes)).json;
    assert.equal(created.method, 'PUT');
    assert.equal((await putTo(created.uploadUrl, bytes)).status, 200, 'байты приняты');
    assert.equal((await completeFile(s, s.alice.token, created.fileId)).status, 200, 'загрузка подтверждена');
    const link = (await http(s.base, 'GET', `/files/${enc(created.fileId)}/url`, { token: s.bob.token })).json;
    assert.ok(link, 'участник получил ссылку');
    const u = new URL(link.downloadUrl);
    const got = await http(u.origin, 'GET', u.pathname + u.search, { token: s.bob.token });
    assert.equal(got.status, 200);
    assert.ok(got.buffer.equals(bytes), 'байты совпадают');
    assert.equal(got.headers.get('content-disposition'), 'attachment', 'файл не открывается в браузере');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await s.stop();
  }
});

test('подпись адреса защищает размер и контрольную сумму: подмена отвергается', async () => {
  const s = await start();
  try {
    const bytes = randomBytes(500);
    const created = (await announce(s, s.alice.token, bytes)).json;
    const forged = new URL(created.uploadUrl);
    forged.searchParams.set('sig', '0'.repeat(64));
    assert.equal((await putTo(forged.toString(), bytes)).status, 403, 'чужая подпись');
    const extended = new URL(created.uploadUrl);
    extended.searchParams.set('expires', String(Number(extended.searchParams.get('expires')) + MIN));
    assert.equal((await putTo(extended.toString(), bytes)).status, 403, 'срок продлён без новой подписи');
    assert.equal((await putTo(created.uploadUrl, bytes)).status, 200, 'настоящий адрес работает');
  } finally {
    await s.stop();
  }
});

test('ссылка загрузки истекает через 15 минут', async () => {
  const s = await start();
  try {
    const bytes = randomBytes(200);
    const created = (await announce(s, s.alice.token, bytes)).json;
    s.srv.advance(16 * MIN);
    assert.equal((await putTo(created.uploadUrl, bytes)).status, 403);
    await s.alice.renewSession(); // истёк access token, проверяем уже состояние резервации
    assert.equal((await http(s.base, 'GET', `/files/${enc(created.fileId)}/url`, { token: s.alice.token })).status, 404,
      'expired signed upload reservation is released immediately');
  } finally {
    await s.stop();
  }
});

test('подтверждение загрузки привязано к устройству, создавшему резервирование', async () => {
  const s = await start();
  try {
    const other = await ChatClient.loginFromNewDevice(s.base, ALICE, PW, 'A_OTHER', s.alice);
    const bytes = randomBytes(120);
    const created = (await announce(s, s.alice.token, bytes)).json;
    assert.equal((await putTo(created.uploadUrl, bytes)).status, 200);
    assert.equal((await completeFile(s, other.token, created.fileId)).status, 403,
      'другое активное устройство не может завершить чужую загрузку');
    assert.equal((await completeFile(s, s.alice.token, created.fileId)).status, 200,
      'резервировавшее устройство может завершить загрузку');
  } finally {
    await s.stop();
  }
});

test('отзыв устройства немедленно аннулирует незавершённую ссылку загрузки', async () => {
  const s = await start();
  try {
    const other = await ChatClient.loginFromNewDevice(s.base, ALICE, PW, 'A_OTHER', s.alice);
    const bytes = randomBytes(140);
    const created = (await announce(s, other.token, bytes)).json;
    await s.alice.raw('DELETE', '/devices/A_OTHER');
    assert.equal((await putTo(created.uploadUrl, bytes)).status, 403,
      'подписанная ссылка больше не работает после отзыва устройства');
    assert.equal((await completeFile(s, other.token, created.fileId)).status, 401,
      'отозванное устройство не может завершить загрузку');
  } finally {
    await s.stop();
  }
});

test('больше заявленного размера не принимается', async () => {
  const s = await start();
  try {
    const declared = randomBytes(100);
    const created = (await announce(s, s.alice.token, declared)).json;
    const bigger = randomBytes(200);
    assert.equal((await putTo(created.uploadUrl, bigger)).status, 413);
  } finally {
    await s.stop();
  }
});

test('неверная контрольная сумма: файл не принимается и не подтверждается', async () => {
  const s = await start();
  try {
    const promised = randomBytes(300);
    const other = randomBytes(300);
    const created = (await announce(s, s.alice.token, promised)).json;
    assert.equal((await putTo(created.uploadUrl, other)).status, 422, 'сумма не совпала');
    assert.equal((await completeFile(s, s.alice.token, created.fileId)).status, 404, 'failed upload reservation was released');
  } finally {
    await s.stop();
  }
});

test('доступ к файлу комнаты только у её участников', async () => {
  const s = await start();
  try {
    assert.equal((await announce(s, s.carol.token, randomBytes(50))).status, 403, 'чужой не загружает в комнату');
    const fileId = await uploadReady(s, s.alice.token, randomBytes(400));
    assert.equal((await http(s.base, 'GET', `/files/${enc(fileId)}/url`, { token: s.bob.token })).status, 200, 'участник получает ссылку');
    assert.equal((await http(s.base, 'GET', `/files/${enc(fileId)}/url`, { token: s.carol.token })).status, 403, 'не участник ссылку не получает');
  } finally {
    await s.stop();
  }
});

test('к сообщению прикрепляется только готовый файл своей комнаты', async () => {
  const s = await start();
  try {
    const message = mlsMessageAt(ROOM, 1, 'с файлом');
    const pending = (await announce(s, s.alice.token, randomBytes(60))).json.fileId;
    const notReady = await http(s.base, 'POST', `/mls/groups/${enc(ROOM)}/messages`, { token: s.alice.token, body: jsonBody({ message, kind: 'text', forwarded: false, fileId: pending }), headers: JSON_HEADERS });
    assert.equal(notReady.status, 400, 'неготовый файл не прикрепляется');
    const fileId = await uploadReady(s, s.alice.token, randomBytes(70));
    const sent = await http(s.base, 'POST', `/mls/groups/${enc(ROOM)}/messages`, { token: s.alice.token, body: jsonBody({ message: mlsMessageAt(ROOM, 1, 'готово'), kind: 'text', forwarded: false, fileId }), headers: JSON_HEADERS });
    assert.equal(sent.status, 200);
    const events = (await s.alice.raw('GET', `/rooms/${enc(ROOM)}/events`)).events;
    const event = events.find((e) => e.event_id === sent.json.event_id);
    assert.equal(event.content.file, fileId, 'в ленте есть ссылка на файл');
    const otherRoomFile = await uploadReady(s, s.bob.token, randomBytes(80), { roomId: undefined, kind: 'avatar' });
    const foreign = await http(s.base, 'POST', `/mls/groups/${enc(ROOM)}/messages`, { token: s.alice.token, body: jsonBody({ message: mlsMessageAt(ROOM, 1, 'чужой'), kind: 'text', forwarded: false, fileId: otherRoomFile }), headers: JSON_HEADERS });
    assert.equal(foreign.status, 400, 'чужой файл не прикрепляется');
  } finally {
    await s.stop();
  }
});

test('лимит незавершённых загрузок: двадцать, потом отказ', async () => {
  const s = await start();
  try {
    for (let i = 0; i < 20; i++) assert.equal((await announce(s, s.alice.token, randomBytes(10))).status, 200);
    assert.equal((await announce(s, s.alice.token, randomBytes(10))).status, 429);
  } finally {
    await s.stop();
  }
});

test('очистка: брошенные загрузки старше суток удаляются, готовые остаются', async () => {
  const s = await start();
  try {
    const abandoned = (await announce(s, s.alice.token, randomBytes(30))).json.fileId;
    const kept = await uploadReady(s, s.alice.token, randomBytes(40));
    s.srv.advance(DAY + MIN);
    assert.equal(await s.srv.cleanupFiles(), 1, 'удалена одна брошенная загрузка');
    await s.alice.renewSession(); // сутки прошли: сессия обновляется, как в приложении
    assert.equal((await http(s.base, 'GET', `/files/${enc(abandoned)}/url`, { token: s.alice.token })).status, 404, 'брошенная пропала');
    assert.equal((await http(s.base, 'GET', `/files/${enc(kept)}/url`, { token: s.alice.token })).status, 200, 'готовая осталась');
  } finally {
    await s.stop();
  }
});

test('подмена Host не влияет на origin подписанной ссылки', async () => {
  const s = await start();
  try {
    const bytes = randomBytes(64);
    const payload = JSON.stringify({
      kind: 'file',
      size: bytes.length,
      sha256: sha(bytes),
      roomId: ROOM,
    });
    const result = await new Promise((resolve, reject) => {
      const request = nodeRequest({
        hostname: '127.0.0.1',
        port: s.srv.server.address().port,
        method: 'POST',
        path: '/files',
        headers: {
          host: 'attacker.invalid',
          authorization: `Bearer ${s.alice.token}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ status: response.statusCode, json: body ? JSON.parse(body) : {} });
        });
      });
      request.on('error', reject);
      request.end(payload);
    });
    assert.equal(result.status, 200);
    assert.equal(new URL(result.json.uploadUrl).origin, 'https://inone.test',
      'внешний Host не должен попадать в подписанный URL');
  } finally {
    await s.stop();
  }
});


test('параллельные резервации не превышают квоту владельца', async () => {
  const s = await start({ quotaBytes: 1000 });
  try {
    const requests = await Promise.all(Array.from({ length: 20 }, () =>
      announce(s, s.alice.token, Buffer.alloc(100))));
    assert.equal(requests.filter((r) => r.status === 200).length, 10,
      'ровно десять заявок по 100 байт укладываются в квоту 1000');
    assert.equal(requests.filter((r) => r.status === 413).length, 10,
      'остальные запросы отклоняются после сериализованной проверки квоты');
  } finally {
    await s.stop();
  }
});

test('ошибка удаления сохраняет tombstone и повторная очистка завершает удаление', async () => {
  const { createMemoryObjectStore } = await import('../src/object-store.js');
  const backing = createMemoryObjectStore();
  let failRemoval = true;
  const objectStore = {
    put: (...args) => backing.put(...args),
    putStream: (...args) => backing.putStream(...args),
    get: (...args) => backing.get(...args),
    getStream: (...args) => backing.getStream(...args),
    remove: async (key) => {
      if (failRemoval) {
        failRemoval = false;
        throw new Error('simulated object-store outage');
      }
      return backing.remove(key);
    },
  };
  const s = await start({ objectStore });
  try {
    const abandoned = (await announce(s, s.alice.token, randomBytes(30))).json.fileId;
    s.srv.advance(DAY + MIN);
    assert.equal(await s.srv.cleanupFiles(), 0, 'failed object deletion is not finalized');
    await s.alice.renewSession(); // истёк access token, проверяем tombstone под новой сессией
    assert.equal((await http(s.base, 'GET', `/files/${enc(abandoned)}/url`, { token: s.alice.token })).status, 409,
      'deleting metadata remains as a retryable tombstone');
    assert.equal(await s.srv.cleanupFiles(), 1, 'next sweep retries and finalizes deletion');
    assert.equal((await http(s.base, 'GET', `/files/${enc(abandoned)}/url`, { token: s.alice.token })).status, 404);
  } finally {
    await s.stop();
  }
});


test('upload and completion fail closed after room membership is revoked', async () => {
  const s = await start();
  try {
    const beforePut = randomBytes(64);
    const first = (await announce(s, s.bob.token, beforePut)).json;
    await s.alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
      epoch: 1, commit: b64('REMOVE-BOB-BEFORE-UPLOAD'),
      changes: { adds: [], removes: [BOB] },
    });
    assert.equal((await putTo(first.uploadUrl, beforePut)).status, 403,
      'membership revoked after announce is revalidated after the stream');
    assert.equal((await completeFile(s, s.bob.token, first.fileId)).status, 404,
      'a rejected upload cannot be completed');

    const secondRoom = '!files-second-revoke:inone.test';
    await s.alice.createRoom(secondRoom, [ALICE, BOB]);
    await s.alice.raw('POST', `/mls/groups/${enc(secondRoom)}/commits`, {
      epoch: 0, commit: b64('SECOND-ROOM-INITIAL'),
      changes: { adds: [], removes: [] },
    });
    const secondBytes = randomBytes(72);
    const second = (await announce(s, s.bob.token, secondBytes, { roomId: secondRoom })).json;
    assert.equal((await putTo(second.uploadUrl, secondBytes)).status, 200);
    await s.alice.raw('POST', `/mls/groups/${enc(secondRoom)}/commits`, {
      epoch: 1, commit: b64('REMOVE-BOB-BEFORE-COMPLETE'),
      changes: { adds: [], removes: [BOB] },
    });
    assert.equal((await completeFile(s, s.bob.token, second.fileId)).status, 403,
      'membership revoked between PUT and complete blocks ready transition');
  } finally {
    await s.stop();
  }
});


test('неудачная загрузка освобождает квоту и слот pending reservation', async () => {
  const s = await start({ quotaBytes: 64 });
  try {
    const expected = randomBytes(64);
    const created = (await announce(s, s.alice.token, expected)).json;
    assert.equal((await putTo(created.uploadUrl, randomBytes(64))).status, 422,
      'checksum mismatch fails the upload');
    const retry = await announce(s, s.alice.token, expected);
    assert.equal(retry.status, 200,
      'failed upload tombstone is finalized and its reservation is released');
  } finally {
    await s.stop();
  }
});


test('параллельные резервации разных владельцев не превышают квоту организации', async () => {
  const s = await start();
  try {
    const { orgs } = await s.alice.raw('GET', '/orgs/mine');
    const orgId = orgs[0]?.orgId;
    assert.ok(orgId, 'test users belong to the default organization');
    // Test fixture: give Alice the owner role so the quota setting is changed through the real authorized route.
    await s.store.setOrgMemberRole(orgId, ALICE, 'owner');
    const setting = await s.alice.raw('POST', `/orgs/${enc(orgId)}/settings`, { field: 'fileQuotaBytes', value: 1000 });
    assert.equal(setting.settings.fileQuotaBytes, 1000);
    const requests = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      announce(s, index % 2 === 0 ? s.alice.token : s.bob.token, Buffer.alloc(100))));
    assert.equal(requests.filter((r) => r.status === 200).length, 10,
      'organization advisory lock serializes reservations across owners');
    assert.equal(requests.filter((r) => r.status === 413 && r.json?.code === 'org_quota_exceeded').length, 10);
  } finally {
    await s.stop();
  }
});


test('параллельные pending reservations не превышают лимит владельца', async () => {
  const s = await start();
  try {
    const requests = await Promise.all(Array.from({ length: 25 }, () =>
      announce(s, s.alice.token, Buffer.alloc(10))));
    assert.equal(requests.filter((r) => r.status === 200).length, 20);
    assert.equal(requests.filter((r) => r.status === 429).length, 5);
  } finally {
    await s.stop();
  }
});


test('одна upload reservation допускает только один параллельный PUT', async () => {
  const s = await start();
  try {
    const bytes = randomBytes(4096);
    const created = (await announce(s, s.alice.token, bytes)).json;
    const results = await Promise.all([
      putTo(created.uploadUrl, bytes),
      putTo(created.uploadUrl, bytes),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort((a, b) => a - b), [200, 409]);
    assert.equal((await completeFile(s, s.alice.token, created.fileId)).status, 200,
      'the winning stream remains completable');
  } finally {
    await s.stop();
  }
});


test('upload completion discards ciphertext after send capability is revoked', async () => {
  const s = await start();
  try {
    const bytes = randomBytes(96);
    const created = (await announce(s, s.bob.token, bytes)).json;
    assert.equal((await putTo(created.uploadUrl, bytes)).status, 200);
    await s.alice.raw('POST', `/rooms/${enc(ROOM)}/capabilities`, { userId: BOB, capabilities: [] });
    assert.equal((await completeFile(s, s.bob.token, created.fileId)).status, 403);
    assert.equal((await http(s.base, 'GET', `/files/${enc(created.fileId)}/url`, { token: s.bob.token })).status, 404,
      'unauthorized uploaded ciphertext is tombstoned and removed');
  } finally {
    await s.stop();
  }
});
