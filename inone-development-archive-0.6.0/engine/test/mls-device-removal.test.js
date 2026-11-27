import { randomBytes } from 'node:crypto';
// Отозванные устройства в группах MLS: сервер помнит, что их листья ещё стоят в группе, и закрывает запись коммитом.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!removal:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

async function setup() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  await alice.createRoom(ROOM, [BOB]);
  return { db, srv, base, alice, bob, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('отозванное устройство остаётся в списке удалений только у своего пользователя, пока коммит его не удалит', async () => {
  const s = await setup();
  try {
    const bobOld = await ChatClient.loginFromNewDevice(s.base, BOB, PW, 'B_OLD', s.bob);
    assert.equal(bobOld.token !== undefined, true);
    await s.bob.raw('DELETE', `/devices/${enc('B_OLD')}`);
    assert.deepEqual((await s.bob.raw('GET', '/mls/removals')).removals, [{ roomId: ROOM, deviceId: 'B_OLD' }], 'свои устройства видят отозванное');
    assert.deepEqual((await s.alice.raw('GET', '/mls/removals')).removals, [], 'чужие не видят');
    await assert.rejects(s.bob.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 1, commit: b64('X'), changes: { adds: [], removes: [], removeDevices: ['GHOST'] } }), (e) => e.status === 400, 'нельзя удалить то, что не ждёт удаления');
    assert.equal((await s.bob.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch, 1, 'эпоха не сдвинулась');
    assert.equal((await s.bob.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 1, commit: b64('REMOVE-OLD'), changes: { adds: [], removes: [], removeDevices: ['B_OLD'] } })).epoch, 2);
    assert.deepEqual((await s.bob.raw('GET', '/mls/removals')).removals, [], 'после коммита запись закрыта');
  } finally {
    await s.stop();
  }
});
