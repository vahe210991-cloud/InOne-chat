import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createMemoryStore } from '../src/store-memory.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice-to-device:inone.test';
const BOB = '@bob-to-device:inone.test';
const ORG_A = 'org-to-device-a';
const ORG_B = 'org-to-device-b';
const enc = encodeURIComponent;

async function start({ rateLimits } = {}) {
  const db = await storeForTest(PEPPER);
  const store = db?.store ?? createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({
    defaultOrgAutoJoin: false,
    registrationMode: 'open',
    requirePhone: false,
    pinPepper: PEPPER,
    store,
    rateLimits,
  });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
  await store.createOrganization({ orgId: ORG_A, name: 'A', status: 'approved', createdBy: ALICE, createdAt: 1 });
  await store.createOrganization({ orgId: ORG_B, name: 'B', status: 'approved', createdBy: BOB, createdAt: 2 });
  await store.addOrgMember(ORG_A, ALICE, 'owner', 3);
  await store.addOrgMember(ORG_B, BOB, 'owner', 4);
  return {
    base, store, alice, bob,
    async linkOrganizations() {
      const proposed = await alice.raw('POST', `/orgs/${ORG_A}/links`, { targetOrgId: ORG_B });
      await bob.raw('POST', `/orgs/${ORG_B}/links/${enc(proposed.linkId)}/accept`, {});
    },
    stop: async () => {
      await new Promise((resolve) => srv.server.close(resolve));
      await db?.close();
    },
  };
}

const deviceKeys = {
  user_id: BOB,
  device_id: 'B_PHONE',
  keys: { ed25519: 'bob-ed25519', curve25519: 'bob-curve25519' },
};

test('keys/query and to-device delivery do not expose or reach unrelated organizations', async () => {
  const s = await start();
  try {
    await s.bob.raw('POST', '/keys/upload', { device_keys: deviceKeys });
    const queried = await s.alice.raw('POST', '/keys/query', { device_keys: { [BOB]: {} } });
    assert.deepEqual(queried.device_keys[BOB], {}, 'unrelated user device keys are not disclosed');

    await s.alice.raw('PUT', '/sendToDevice/m.room.encrypted/txn-unrelated-0001', {
      messages: { [BOB]: { B_PHONE: { ciphertext: 'opaque-ciphertext' } } },
    });
    const queue = await s.store.drainQueue(`${BOB}|B_PHONE`, 0, 0, Date.now());
    assert.equal(queue.filter((event) => event.stream === 'to_device').length, 0,
      'unrelated user receives no to-device event');
  } finally {
    await s.stop();
  }
});

test('active organization link permits device-key query and encrypted to-device delivery', async () => {
  const s = await start();
  try {
    await s.bob.raw('POST', '/keys/upload', { device_keys: deviceKeys });
    await s.linkOrganizations();
    const queried = await s.alice.raw('POST', '/keys/query', { device_keys: { [BOB]: {} } });
    assert.equal(queried.device_keys[BOB].B_PHONE.keys.ed25519, 'bob-ed25519');

    const message = {
      messages: { [BOB]: { B_PHONE: { ciphertext: 'opaque-ciphertext' } } },
    };
    await s.alice.raw('PUT', '/sendToDevice/m.room.encrypted/txn-linked-0001', message);
    await s.alice.raw('PUT', '/sendToDevice/m.room.encrypted/txn-linked-0001', message);
    const queue = await s.store.drainQueue(`${BOB}|B_PHONE`, 0, 0, Date.now());
    const deliveries = queue.filter((event) => event.stream === 'to_device');
    assert.equal(deliveries.length, 1, 'replayed transaction does not duplicate queued messages');
    assert.ok(deliveries[0].dedupeKey, 'to-device queue entries always have a non-null dedupe key');
    assert.equal(deliveries[0].body.type, 'm.room.encrypted');
    assert.equal(deliveries[0].body.content.ciphertext, 'opaque-ciphertext');
  } finally {
    await s.stop();
  }
});

test('to-device messages enforce per-sender rate and payload limits', async () => {
  const s = await start({ rateLimits: { toDevicePerAccount: [{ windowMs: 60_000, limit: 2 }] } });
  try {
    await s.linkOrganizations();
    const send = (txn) => s.alice.raw('PUT', `/sendToDevice/m.room.encrypted/${txn}`, {
      messages: { [BOB]: { B_PHONE: { ciphertext: 'x' } } },
    });
    await send('txn-rate-0001');
    await send('txn-rate-0002');
    await assert.rejects(send('txn-rate-0003'), (error) => error.status === 429);

  } finally {
    await s.stop();
  }
});

test('oversized to-device payload is rejected before enqueue', async () => {
  const s = await start();
  try {
    await s.linkOrganizations();
    await assert.rejects(
      s.alice.raw('PUT', '/sendToDevice/m.room.encrypted/txn-large-0001', {
        messages: { [BOB]: { B_PHONE: { ciphertext: 'x'.repeat(300 * 1024) } } },
      }),
      (error) => error.status === 413,
    );
    const queue = await s.store.drainQueue(`${BOB}|B_PHONE`, 0, 0, Date.now());
    assert.equal(queue.filter((event) => event.stream === 'to_device').length, 0);
  } finally {
    await s.stop();
  }
});

test('recipient to-device queue cap is atomic under concurrent PostgreSQL or memory-store writes', async () => {
  const s = await start();
  try {
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) =>
      s.store.enqueueToDevice(
        `${BOB}|B_PHONE`,
        { type: 'm.room.encrypted', sender: ALICE, content: { sequence: i } },
        `queue-cap-test-${i}`,
        now + 60_000,
        now,
        10,
        BOB,
        BOB,
      )));
    assert.equal(results.filter((result) => result.ok).length, 10);
    assert.equal(results.filter((result) => result.reason === 'queue_full').length, 30);
    const queue = await s.store.drainQueue(`${BOB}|B_PHONE`, 0, 0, now);
    assert.equal(queue.filter((event) => event.stream === 'to_device').length, 10);
  } finally {
    await s.stop();
  }
});
