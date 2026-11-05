import { randomBytes } from 'node:crypto';
// Ключевые пакеты MLS: загрузка, счётчик, выдача каждого пакета один раз, проверки входа и размера.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const enc = encodeURIComponent;
const pkg = (name) => Buffer.from(`KEYPACKAGE-${name}-${'x'.repeat(40)}`).toString('base64');

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, db, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('устройство загружает ключевые пакеты, счётчик их учитывает', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const up = await alice.raw('POST', '/mls/key-packages', { packages: [pkg('1'), pkg('2'), pkg('3')] });
    assert.equal(up.stored, 3);
    assert.equal(up.available, 3);
    assert.equal((await alice.raw('GET', '/mls/key-packages/count')).available, 3);
  } finally {
    await stop();
  }
});

test('пакет выдаётся один раз: следующий запрос отдаёт другой пакет, после них — пусто', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await alice.raw('POST', '/mls/key-packages', { packages: [pkg('1'), pkg('2')] });
    const first = await bob.raw('GET', `/mls/key-packages/${enc(ALICE)}`);
    const second = await bob.raw('GET', `/mls/key-packages/${enc(ALICE)}`);
    assert.equal(first.packages.length, 1);
    assert.equal(second.packages.length, 1);
    assert.equal(first.packages[0].deviceId, 'A_PHONE');
    assert.notEqual(first.packages[0].package, second.packages[0].package, 'пакет не выдаётся повторно');
    assert.deepEqual((await bob.raw('GET', `/mls/key-packages/${enc(ALICE)}`)).packages, [], 'пакеты кончились — пустой список, а не ошибка');
    assert.equal((await alice.raw('GET', '/mls/key-packages/count')).available, 0);
  } finally {
    await stop();
  }
});

test('неверные пакеты отклоняются: пустой список, не base64, слишком большой пакет, больше 50 за раз, больше 100 неиспользованных', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await assert.rejects(alice.raw('POST', '/mls/key-packages', { packages: [] }), (e) => e.status === 400);
    await assert.rejects(alice.raw('POST', '/mls/key-packages', { packages: ['не base64!'] }), (e) => e.status === 400);
    await assert.rejects(alice.raw('POST', '/mls/key-packages', { packages: [Buffer.alloc(5000, 1).toString('base64')] }), (e) => e.status === 400);
    await assert.rejects(alice.raw('POST', '/mls/key-packages', { packages: Array.from({ length: 51 }, (_, i) => pkg(`${i}`)) }), (e) => e.status === 400);
    await alice.raw('POST', '/mls/key-packages', { packages: Array.from({ length: 50 }, (_, i) => pkg(`a${i}`)) });
    await alice.raw('POST', '/mls/key-packages', { packages: Array.from({ length: 50 }, (_, i) => pkg(`b${i}`)) });
    await assert.rejects(alice.raw('POST', '/mls/key-packages', { packages: [pkg('лишний')] }), (e) => e.status === 409);
  } finally {
    await stop();
  }
});

test('без входа пакеты не загружаются и не отдаются', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await alice.raw('POST', '/mls/key-packages', { packages: [pkg('1')] });
    const anon = await fetch(`${base}/mls/key-packages/${enc(ALICE)}`);
    assert.equal(anon.status, 401);
    const upload = await fetch(`${base}/mls/key-packages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packages: [pkg('x')] }) });
    assert.equal(upload.status, 401);
  } finally {
    await stop();
  }
});
