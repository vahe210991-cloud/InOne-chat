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
const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');

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

test('room-bound KeyPackage reservation succeeds in the PostgreSQL transaction', async () => {
  const { base, store, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await bob.raw('POST', '/mls/key-packages', { packages: [pkg('claim-db-regression')] });
    const roomId = '!claim-db-regression:inone.test';
    await alice.raw('POST', '/rooms', { roomId, members: [ALICE] });
    const claim = await store.mlsClaimKeyPackages(
      BOB, ALICE, 'A_PHONE', 'claim-db-regression-0001', roomId, Date.now(),
    );
    assert.equal(claim.ok, true);
    assert.equal(claim.packages.length, 1);
    assert.equal(claim.packages[0].deviceId, 'B_PHONE');
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


test('parallel KeyPackage claims consume each one-time package at most once', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await alice.raw('POST', '/mls/key-packages', { packages: Array.from({ length: 5 }, (_, i) => pkg(`parallel-${i}`)) });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      bob.raw('POST', `/mls/key-packages/${enc(ALICE)}/claim`, { claimId: `parallel-claim-${String(i).padStart(8, '0')}` })));
    const packages = results.flatMap((result) => result.packages.map((item) => item.package));
    assert.equal(packages.length, 5, 'only the five uploaded packages can be consumed');
    assert.equal(new Set(packages).size, 5, 'parallel claimants never receive the same one-time package');
    assert.equal((await alice.raw('GET', '/mls/key-packages/count')).available, 0);
  } finally {
    await stop();
  }
});

test('parallel retries of one KeyPackage claim ID return the same reservation', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await alice.raw('POST', '/mls/key-packages', { packages: [pkg('parallel-replay')] });
    const claim = () => bob.raw('POST', `/mls/key-packages/${enc(ALICE)}/claim`, { claimId: 'parallel-replay-0001' });
    const results = await Promise.all([claim(), claim(), claim(), claim()]);
    assert.ok(results.every((result) => result.packages.length === 1));
    assert.equal(new Set(results.map((result) => result.packages[0].package)).size, 1);
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


test('parallel KeyPackage uploads cannot exceed the per-device unused package quota', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const uploads = await Promise.allSettled(Array.from({ length: 3 }, (_, batch) =>
      alice.raw('POST', '/mls/key-packages', {
        packages: Array.from({ length: 40 }, (_, i) => pkg(`quota-${batch}-${i}`)),
      })));
    assert.equal(uploads.filter((result) => result.status === 'fulfilled').length, 2);
    assert.equal(uploads.filter((result) => result.status === 'rejected' && result.reason.status === 409).length, 1);
    assert.equal((await alice.raw('GET', '/mls/key-packages/count')).available, 80);
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




test('device revocation removes pending MLS Welcomes and blocks acknowledgement', async () => {
  const { base, store, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await ChatClient.create(base, BOB, 'B_PHONE', PW);
    const roomId = '!welcome-revoke-cleanup:inone.test';
    await alice.raw('POST', '/rooms', { roomId, members: [] });
    await alice.raw('POST', `/mls/groups/${enc(roomId)}/commits`, {
      epoch: 0,
      commit: b64('welcome-before-device-revoke'),
      clientOperationId: 'welcome-revoke-cleanup-0001',
      changes: { adds: [BOB], removes: [] },
      welcomes: [{ userId: BOB, deviceId: 'B_PHONE', welcome: b64('welcome-material') }],
    });
    const pending = await store.mlsPendingWelcomes(BOB, 'B_PHONE');
    assert.equal(pending.length, 1);
    await store.revokeDevice(`${BOB}|B_PHONE`);
    assert.deepEqual(await store.mlsPendingWelcomes(BOB, 'B_PHONE'), []);
    assert.equal(await store.mlsAckWelcome(pending[0].id, BOB, 'B_PHONE', Date.now()), false);
  } finally {
    await stop();
  }
});

test('MLS commit rejects a Welcome targeting a revoked device', async () => {
  const { base, store, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await ChatClient.create(base, BOB, 'B_PHONE', PW);
    const roomId = '!revoked-welcome-device:inone.test';
    assert.equal((await alice.raw('POST', '/rooms', { roomId, members: [] })).roomId, roomId);
    await store.revokeDevice(`${BOB}|B_PHONE`);
    await assert.rejects(
      alice.raw('POST', `/mls/groups/${enc(roomId)}/commits`, {
        epoch: 0,
        commit: b64('revoked-welcome-commit'),
        clientOperationId: 'revoked-welcome-device-0001',
        changes: { adds: [BOB], removes: [] },
        welcomes: [{ userId: BOB, deviceId: 'B_PHONE', welcome: b64('revoked-welcome') }],
      }),
      (error) => error.status === 409 && error.code === 'welcome_device_revoked',
    );
    assert.equal((await alice.raw('GET', `/rooms/${enc(roomId)}/members`)).members.includes(BOB), false);
  } finally {
    await stop();
  }
});

test('revoking a device purges its MLS KeyPackages and filters stored claim replays', async () => {
  const { base, store, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await alice.raw('POST', '/mls/key-packages', { packages: [pkg('revoke-1'), pkg('revoke-2')] });
    const path = `/mls/key-packages/${enc(ALICE)}/claim`;
    const first = await bob.raw('POST', path, { claimId: 'claim-before-revoke-0001' });
    assert.equal(first.packages.length, 1);

    await store.revokeDevice(`${ALICE}|A_PHONE`);
    const replay = await bob.raw('POST', path, { claimId: 'claim-before-revoke-0001' });
    assert.deepEqual(replay.packages, [], 'a replay cannot disclose a package for a revoked device');
    const fresh = await bob.raw('POST', path, { claimId: 'claim-after-revoke-0001' });
    assert.deepEqual(fresh.packages, [], 'new claims cannot reserve packages for a revoked device');
    assert.equal(await store.mlsAvailableCount(ALICE, 'A_PHONE', Date.now()), 0);
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
    await assert.rejects(
      alice.raw('POST', `/mls/groups/${enc(roomId)}/commits`, {
        epoch: 0,
        commit: b64('outsider-commit'),
        clientOperationId: 'commit-outsider-0001',
        changes: { adds: [BOB], removes: [] },
        welcomes: [{ userId: BOB, deviceId: 'B_PHONE', welcome: b64('outsider-welcome') }],
      }),
      (error) => error.status === 403,
      'the MLS commit endpoint must not bypass KeyPackage authorization and add an unrelated user',
    );
    assert.equal((await bob.raw('GET', '/mls/key-packages/count')).available, 1,
      'denied claims must not consume the target device package');

    const proposed = await alice.raw('POST', '/orgs/org-mls-a/links', { targetOrgId: 'org-mls-b' });
    assert.equal(proposed.status, 'proposed');
    await bob.raw('POST', `/orgs/org-mls-b/links/${enc(proposed.linkId)}/accept`, {});
    const allowed = await alice.raw('POST', `/mls/key-packages/${enc(BOB)}/claims`, {
      claimId: 'claim-room-linked-0001',
      roomId,
    });
    assert.equal(allowed.packages.length, 1,
      'an active organization link permits a room-bound claim by an authorized inviter');
    assert.equal((await bob.raw('GET', '/mls/key-packages/count')).available, 0);
    const committed = await alice.raw('POST', `/mls/groups/${enc(roomId)}/commits`, {
      epoch: 0,
      commit: b64('linked-organization-commit'),
      clientOperationId: 'claim-room-linked-0001',
      keyPackageClaimId: 'claim-room-linked-0001',
      changes: { adds: [BOB], removes: [] },
      welcomes: allowed.packages.map((item) => ({
        userId: BOB,
        deviceId: item.deviceId,
        welcome: b64(`linked-welcome-${item.deviceId}`),
      })),
    });
    assert.equal(committed.epoch, 1);
    assert.ok((await alice.raw('GET', `/rooms/${enc(roomId)}/members`)).members.includes(BOB));
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
