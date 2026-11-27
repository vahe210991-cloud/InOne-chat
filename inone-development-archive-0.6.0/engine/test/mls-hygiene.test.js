import { randomBytes } from 'node:crypto';
// Гигиена MLS: приветствие только известному аккаунту; отзыв устройства убирает его пакеты и приветствия.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!hygiene:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const pkg = (name) => b64(`KEYPACKAGE-${name}-${'x'.repeat(40)}`);
const claimKeyPackages = (client, userId) => client.raw('POST', `/mls/key-packages/${enc(userId)}/claim`, { claimId: randomBytes(16).toString('hex') });

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { base, db, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('приветствие неизвестному аккаунту отклоняется до записи коммита', async () => {
  const s = await start();
  try {
    const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
    await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
    await alice.createRoom(ROOM, [ALICE, BOB]);
    const epoch = (await alice.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch;
    await assert.rejects(alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
      epoch, commit: b64('COMMIT-1'), welcomes: [{ userId: '@ghost:inone.test', deviceId: 'G_PHONE', welcome: b64('WELCOME') }],
    }), (e) => e.status === 400, 'неизвестный получатель');
    assert.equal((await alice.raw('GET', `/mls/groups/${enc(ROOM)}/epoch`)).epoch, epoch, 'эпоха не сдвинулась');
  } finally {
    await s.stop();
  }
});

test('отзыв устройства убирает его неиспользованные ключевые пакеты и приветствия', async () => {
  const s = await start();
  try {
    const alice = await ChatClient.create(s.base, ALICE, 'A_PHONE', PW);
    const bobPhone = await ChatClient.create(s.base, BOB, 'B_PHONE', PW);
    const bobOld = await ChatClient.loginFromNewDevice(s.base, BOB, PW, 'B_OLD', bobPhone);
    await bobOld.raw('POST', '/mls/key-packages', { packages: [pkg('old-1'), pkg('old-2')] });
    await bobPhone.raw('POST', '/mls/key-packages', { packages: [pkg('phone-1')] });
    await bobPhone.raw('DELETE', `/devices/${enc('B_OLD')}`);
    const claimed = (await claimKeyPackages(alice, BOB)).packages.map((p) => p.deviceId);
    assert.ok(!claimed.includes('B_OLD'), 'пакеты отозванного устройства не выдаются');
    assert.ok(claimed.includes('B_PHONE'), 'пакеты действующего устройства выдаются');
    assert.equal((await bobPhone.raw('GET', '/mls/key-packages/count')).available, 0, 'пакеты действующего устройства уже выданы этим запросом');
  } finally {
    await s.stop();
  }
});
