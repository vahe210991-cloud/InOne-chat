import { randomBytes } from 'node:crypto';
// Резервный ключевой пакет: выдаётся, когда обычные пакеты закончились; не расходуется; один на устройство.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const enc = encodeURIComponent;
const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const plain = (b64text) => Buffer.from(b64text, 'base64').toString('utf8');

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  return { base, alice, bob, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

const claim = (c) => c.raw('GET', `/mls/key-packages/${enc(BOB)}`);

test('обычные пакеты выдаются первыми и расходуются; резервный выдаётся после них и не расходуется', async () => {
  const s = await start();
  try {
    await s.bob.raw('POST', '/mls/key-packages/last-resort', { package: b64('LR-1') });
    assert.equal((await s.bob.raw('GET', '/mls/key-packages/count')).available, 0, 'резервный не считается доступным');
    assert.deepEqual((await claim(s.alice)).packages.map((p) => plain(p.package)), ['LR-1'], 'без обычных выдаётся резервный');
    assert.deepEqual((await claim(s.alice)).packages.map((p) => plain(p.package)), ['LR-1'], 'резервный не расходуется');
    await s.bob.raw('POST', '/mls/key-packages', { packages: [b64('P-1'), b64('P-2')] });
    assert.deepEqual((await claim(s.alice)).packages.map((p) => plain(p.package)), ['P-1'], 'обычный пакет выдаётся первым');
    assert.deepEqual((await claim(s.alice)).packages.map((p) => plain(p.package)), ['P-2']);
    assert.deepEqual((await claim(s.alice)).packages.map((p) => plain(p.package)), ['LR-1'], 'когда обычные закончились, снова резервный');
  } finally {
    await s.stop();
  }
});

test('новый резервный пакет заменяет прежний; неверный пакет отклоняется', async () => {
  const s = await start();
  try {
    await s.bob.raw('POST', '/mls/key-packages/last-resort', { package: b64('LR-OLD') });
    await s.bob.raw('POST', '/mls/key-packages/last-resort', { package: b64('LR-NEW') });
    assert.deepEqual((await claim(s.alice)).packages.map((p) => plain(p.package)), ['LR-NEW'], 'остался один, новый');
    await assert.rejects(s.bob.raw('POST', '/mls/key-packages/last-resort', { package: 'не base64!' }), (e) => e.status === 400);
    await assert.rejects(s.bob.raw('POST', '/mls/key-packages/last-resort', {}), (e) => e.status === 400);
    await assert.rejects(s.bob.raw('POST', '/mls/key-packages/last-resort', { package: Buffer.alloc(5000, 1).toString('base64') }), (e) => e.status === 400, 'слишком большой');
  } finally {
    await s.stop();
  }
});

test('отзыв устройства убирает его резервный пакет', async () => {
  const s = await start();
  try {
    await s.bob.raw('POST', '/mls/key-packages/last-resort', { package: b64('LR-PHONE') });
    const bobOld = await ChatClient.loginFromNewDevice(s.base, BOB, PW, 'B_OLD', s.bob);
    await bobOld.raw('POST', '/mls/key-packages/last-resort', { package: b64('LR-OLD-DEVICE') });
    const before = (await claim(s.alice)).packages.map((p) => p.deviceId).sort();
    assert.deepEqual(before, ['B_OLD', 'B_PHONE']);
    await s.bob.raw('DELETE', `/devices/${enc('B_OLD')}`);
    const after = (await claim(s.alice)).packages.map((p) => p.deviceId);
    assert.deepEqual(after, ['B_PHONE'], 'резервный пакет отозванного устройства больше не выдаётся');
  } finally {
    await s.stop();
  }
});
