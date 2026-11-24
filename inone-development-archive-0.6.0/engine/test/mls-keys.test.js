import { randomBytes } from 'node:crypto';
// Ключевые пакеты MLS: загрузка, счётчик, выдача каждого пакета один раз, проверки входа и размера.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const enc = encodeURIComponent;
const pkg = (name) => Buffer.from(`KEYPACKAGE-${name}-${'x'.repeat(40)}`).toString('base64');

async function start({ defaultOrgAutoJoin = true } = {}) {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, db, store, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
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

test('повтор стабильного KeyPackage claim ID возвращает тот же пакет, новый claim расходует следующий', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await alice.raw('POST', '/mls/key-packages', { packages: [pkg('1'), pkg('2')] });
    const claimPath = `/mls/key-packages/${enc(ALICE)}/claim`;
    const first = await bob.raw('POST', claimPath, { claimId: 'claim-intent-00000001' });
    const replay = await bob.raw('POST', claimPath, { claimId: 'claim-intent-00000001' });
    const second = await bob.raw('POST', claimPath, { claimId: 'claim-intent-00000002' });
    assert.equal(first.packages.length, 1);
    assert.deepEqual(replay, first, 'повтор после потерянного ответа возвращает тот же claim result');
    assert.equal(second.packages.length, 1);
    assert.equal(first.packages[0].deviceId, 'A_PHONE');
    assert.notEqual(first.packages[0].package, second.packages[0].package, 'пакет не выдаётся повторно');
    assert.deepEqual((await bob.raw('POST', claimPath, { claimId: 'claim-intent-00000003' })).packages, [], 'пакеты кончились — пустой список, а не ошибка');
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
    const anon = await fetch(`${base}/mls/key-packages/${enc(ALICE)}/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claimId: 'claim-intent-00000001' }) });
    assert.equal(anon.status, 401);
    const upload = await fetch(`${base}/mls/key-packages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ packages: [pkg('x')] }) });
    assert.equal(upload.status, 401);
  } finally {
    await stop();
  }
});

test('KeyPackage claim rejects users outside the room organization or an active organization link', async () => {
  const { base, store, stop } = await start({ defaultOrgAutoJoin: false });
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await store.createOrganization({ orgId: 'org-mls-a', name: 'A', status: 'approved', createdBy: ALICE, createdAt: 1 });
    await store.createOrganization({ orgId: 'org-mls-b', name: 'B', status: 'approved', createdBy: BOB, createdAt: 2 });
    await store.addOrgMember('org-mls-a', ALICE, 'owner', 3);
    await store.addOrgMember('org-mls-b', BOB, 'owner', 4);
    await bob.raw('POST', '/mls/key-packages', { packages: [pkg('private-to-bob')] });
    const roomId = '!mls-private-room:inone.test';
    assert.equal((await alice.raw('POST', '/rooms', { roomId, orgId: 'org-mls-a', members: [ALICE] })).roomId, roomId);

    await assert.rejects(
      alice.raw('POST', `/mls/key-packages/${enc(BOB)}/claim`, { claimId: 'claim-outsider-000001' }),
      (error) => error.status === 403,
      'legacy claim must enforce the shared organization/active-link policy',
    );
    await assert.rejects(
      alice.raw('POST', `/mls/key-packages/${enc(BOB)}/claims`, {
        claimId: 'claim-room-outsider-0001',
        roomId,
      }),
      (error) => error.status === 403,
      'room-bound claim must reject a target who is not eligible for the room organization',
    );
    assert.equal((await bob.raw('GET', '/mls/key-packages/count')).available, 1,
      'denied claims must not consume the target device package');
  } finally {
    await stop();
  }
});

test('KeyPackage claim требует устойчивый корректный claimId', async () => {
  const { base, stop } = await start();
  try {
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    const path = `/mls/key-packages/${enc(ALICE)}/claim`;
    await assert.rejects(bob.raw('POST', path, {}), (e) => e.status === 400);
    await assert.rejects(bob.raw('POST', path, { claimId: 'short' }), (e) => e.status === 400);
    await assert.rejects(bob.raw('POST', path, { claimId: 'contains spaces and invalid chars' }), (e) => e.status === 400);
  } finally {
    await stop();
  }
});

test('параллельный повтор одного claimId не расходует несколько KeyPackage', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await alice.raw('POST', '/mls/key-packages', { packages: [pkg('one'), pkg('two')] });
    const path = `/mls/key-packages/${enc(ALICE)}/claim`;
    const results = await Promise.all(Array.from({ length: 12 }, () => bob.raw('POST', path, { claimId: 'claim-intent-concurrent-0001' })));
    for (const result of results) assert.deepEqual(result, results[0]);
    assert.equal(results[0].packages.length, 1);
    assert.equal((await alice.raw('GET', '/mls/key-packages/count')).available, 1);
  } finally {
    await stop();
  }
});
