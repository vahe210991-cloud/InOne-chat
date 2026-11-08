import { randomBytes } from 'node:crypto';
// Срок годности ключевых пакетов: обычный старше 30 дней не выдаётся и не учитывается; резервный живёт дольше.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const DAY = 24 * 3600 * 1000;
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
  return { srv, alice, bob, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

const claim = (c) => c.raw('POST', `/mls/key-packages/${enc(BOB)}/claim`, { claimId: randomBytes(16).toString('hex') });

test('обычный пакет старше 30 дней не выдаётся и не учитывается', async () => {
  const s = await start();
  try {
    await s.bob.raw('POST', '/mls/key-packages', { packages: [b64('OLD-1')] });
    s.srv.advance(31 * DAY);
    assert.equal((await s.bob.raw('GET', '/mls/key-packages/count')).available, 0, 'просроченный не считается доступным');
    assert.deepEqual((await claim(s.alice)).packages, [], 'просроченный не выдаётся');
    await s.bob.raw('POST', '/mls/key-packages', { packages: [b64('NEW-1')] });
    assert.deepEqual((await claim(s.alice)).packages.map((p) => plain(p.package)), ['NEW-1'], 'свежий выдаётся');
  } finally {
    await s.stop();
  }
});

test('резервный пакет старше 30 дней, но моложе 180, выдаётся; старше 180 дней — нет', async () => {
  const s = await start();
  try {
    await s.bob.raw('POST', '/mls/key-packages/last-resort', { package: b64('LR-1') });
    s.srv.advance(60 * DAY);
    assert.deepEqual((await claim(s.alice)).packages.map((p) => plain(p.package)), ['LR-1'], 'резервный живёт дольше обычного');
    s.srv.advance(130 * DAY);
    assert.deepEqual((await claim(s.alice)).packages, [], 'после 180 дней резервный не выдаётся');
  } finally {
    await s.stop();
  }
});
