import { randomBytes } from 'node:crypto';
// Размеры сообщений MLS: приветствие для группы в 500 участников (около 120 КБ) принимается; слишком большое — нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!sizes:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const enc = encodeURIComponent;
const blob = (kb) => Buffer.alloc(kb * 1024, 7).toString('base64');

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { base, db, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('приветствие около 120 КБ (группа из 500 участников) принимается и доставляется', async () => {
  const s = await start();
  try {
    const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
    await alice.createRoom(ROOM, [ALICE]);
    const r = await alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
      epoch: 0, commit: blob(8), changes: { adds: [BOB], removes: [] },
      welcomes: [{ userId: BOB, deviceId: 'B_PHONE', welcome: blob(120) }],
    });
    assert.equal(r.epoch, 1);
    const delivered = (await bob.raw('GET', '/mls/welcomes')).welcomes[0];
    assert.equal(Buffer.from(delivered.welcome, 'base64').length, 120 * 1024, 'приветствие доставлено целиком');
  } finally {
    await s.stop();
  }
});

test('приветствие больше 512 КБ и коммит больше 256 КБ отклоняются', async () => {
  const s = await start();
  try {
    const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
    await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
    await alice.createRoom(ROOM, [ALICE]);
    await assert.rejects(alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
      epoch: 0, commit: blob(8), changes: { adds: [BOB], removes: [] },
      welcomes: [{ userId: BOB, deviceId: 'B_PHONE', welcome: blob(600) }],
    }), (e) => e.status === 400, 'слишком большое приветствие');
    await assert.rejects(alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, { epoch: 0, commit: blob(300) }), (e) => e.status === 400, 'слишком большой коммит');
    assert.equal((await alice.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch, 0, 'эпоха не сдвинулась');
  } finally {
    await s.stop();
  }
});
