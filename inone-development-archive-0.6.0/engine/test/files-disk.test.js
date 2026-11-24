// Файлы на диске своего сервера и квота по объёму. Имя файла на диске — случайный идентификатор.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { createFsObjectStore } from '../src/object-store.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!disk:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const enc = encodeURIComponent;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonHeaders = { 'content-type': 'application/json' };

async function http(base, method, p, { token, body, headers = {} } = {}) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });
  const buffer = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buffer.toString('utf8'));
  } catch {
    json = null;
  }
  return { status: res.status, buffer, json };
}

async function start({ filesDir = null, quotaBytes = null } = {}) {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store, objectSecret: 'test-object-secret-0123456789abcdef', filesDir, quotaBytes });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  await alice.createRoom(ROOM, [ALICE, BOB]);
  return { srv, base, alice, bob, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('хранилище на диске: объект называется своим идентификатором; чужие имена отвергаются', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inone-objects-'));
  try {
    const store = createFsObjectStore(dir);
    const id = randomBytes(16).toString('hex');
    await store.put(id, Buffer.from('шифротекст'));
    assert.deepEqual(readdirSync(dir), [id], 'на диске только идентификатор');
    assert.equal((await store.get(id)).toString('utf8'), 'шифротекст');
    await store.remove(id);
    assert.equal(await store.get(id), null);
    await assert.rejects(store.put('../escape', Buffer.from('x')), /hex id/, 'путь наружу не принимается');
    await assert.rejects(store.get('ALICE.txt'), /hex id/, 'имя пользователя не принимается');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('файл из комнаты сохраняется на диске и отдаётся по ссылке', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inone-files-'));
  const s = await start({ filesDir: dir });
  try {
    const bytes = randomBytes(2000);
    const created = (await http(s.base, 'POST', '/files', { token: s.alice.token, body: JSON.stringify({ kind: 'file', size: bytes.length, sha256: sha(bytes), roomId: ROOM }), headers: jsonHeaders })).json;
    const u = new URL(created.uploadUrl);
    assert.equal((await http(u.origin, 'PUT', u.pathname + u.search, { body: bytes, headers: { 'content-length': String(bytes.length), 'content-type': 'application/octet-stream' } })).status, 200);
    assert.equal((await http(s.base, 'POST', `/files/${enc(created.fileId)}/complete`, { token: s.alice.token, body: '{}', headers: jsonHeaders })).status, 200);
    assert.deepEqual(readdirSync(dir), [created.fileId], 'на диске лежит объект с идентификатором файла');
    assert.ok(readFileSync(path.join(dir, created.fileId)).equals(bytes), 'байты на диске те же');
    const link = (await http(s.base, 'GET', `/files/${enc(created.fileId)}/url`, { token: s.bob.token })).json;
    const g = new URL(link.downloadUrl);
    const got = await http(g.origin, 'GET', g.pathname + g.search, { token: s.bob.token });
    assert.equal(got.status, 200);
    assert.ok(got.buffer.equals(bytes), 'участник получает те же байты');
  } finally {
    await s.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('квота по объёму: сверх лимита загрузка не объявляется', async () => {
  const s = await start({ quotaBytes: 1000 });
  try {
    const announce = (size) => http(s.base, 'POST', '/files', { token: s.alice.token, body: JSON.stringify({ kind: 'file', size, sha256: sha(Buffer.alloc(size)), roomId: ROOM }), headers: jsonHeaders });
    assert.equal((await announce(600)).status, 200, 'первые 600 байт');
    assert.equal((await announce(600)).status, 413, 'вторые 600 сверх квоты');
    assert.equal((await announce(400)).status, 200, 'до лимита точно');
    assert.equal((await announce(1)).status, 413, 'и даже один байт сверх');
  } finally {
    await s.stop();
  }
});


test('streaming object writes publish atomically and remove temporary files after abort', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inone-stream-'));
  try {
    const store = createFsObjectStore(dir);
    const id = randomBytes(16).toString('hex');
    const chunks = [Buffer.from('opaque-'), Buffer.from('ciphertext')];
    const written = await store.putStream(id, Readable.from(chunks));
    assert.equal(written.size, 17);
    assert.deepEqual(readdirSync(dir), [id], 'only the finalized object is visible');
    const read = [];
    for await (const chunk of store.getStream(id)) read.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(read), Buffer.concat(chunks));

    const failedId = randomBytes(16).toString('hex');
    const broken = Readable.from((async function* () {
      yield Buffer.from('partial');
      throw new Error('client disconnected');
    })());
    await assert.rejects(store.putStream(failedId, broken), /client disconnected/);
    assert.deepEqual(readdirSync(dir), [id], 'failed stream leaves no temp or published object');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
