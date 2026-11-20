import { randomBytes } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createStore } from '../src/store.js';
import { createPushDelivery } from '../src/push-delivery.js';
import { decryptPushRegistrationId } from '../src/push-crypto.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { testDatabase } from './helpers.js';
import { mlsMessageAt } from './group-message-helper.mjs';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!push-db:inone.test';
const ALICE = '@push-db-alice:inone.test';
const BOB = '@push-db-bob:inone.test';
const FID = 'AbCdEf0123456789_-AbCd';
const enc = encodeURIComponent;
const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');

async function put(base, client, body) {
  const response = await fetch(`${base}/devices/me/push`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${client.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

test('PostgreSQL push outbox is atomic, encrypted, idempotent and survives worker restart', async () => {
  const db = await testDatabase();
  const encryptionKey = randomBytes(32);
  const sent = [];
  const sender = {
    async send(message) {
      sent.push(message);
      return { messageId: `projects/test/messages/${sent.length}` };
    },
  };
  const firstWorker = createPushDelivery({ pool: db.pool, sender, encryptionKey, maxAttempts: 3 });
  await firstWorker.backfillLegacyRegistrations();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const app = createServer({
    defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false,
    pinPepper: PEPPER, store, pushDelivery: firstWorker,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);

    const deviceKey = `${BOB}|B_PHONE`;
    const legacy = 'legacy-registration-identifier-0123456789';
    await db.pool.query(
      'INSERT INTO push_tokens (device_key, provider, token, updated_at) VALUES ($1, $2, $3, $4)',
      [deviceKey, 'fcm', legacy, Date.now()],
    );
    const backfill = await firstWorker.backfillLegacyRegistrations();
    assert.equal(backfill.migrated, 1);
    const migrated = (await db.pool.query('SELECT token, token_ciphertext, token_iv, token_tag, identifier_kind FROM push_tokens WHERE device_key = $1', [deviceKey])).rows[0];
    assert.equal(migrated.token, null);
    assert.equal(migrated.identifier_kind, 'legacy');
    assert.equal(decryptPushRegistrationId(migrated, deviceKey, encryptionKey), legacy);
    assert.equal(JSON.stringify(migrated).includes(legacy), false);

    assert.equal((await put(base, bob, { provider: 'fcm', token: FID })).status, 200);
    const registration = (await db.pool.query('SELECT token, token_ciphertext, identifier_kind FROM push_tokens WHERE device_key = $1', [deviceKey])).rows[0];
    assert.equal(registration.token, null);
    assert.equal(registration.identifier_kind, 'fid');
    assert.equal(JSON.stringify(registration).includes(FID), false);

    await alice.createRoom(ROOM, [ALICE, BOB]);
    await alice.raw('POST', `/mls/groups/${enc(ROOM)}/commits`, {
      epoch: 0, commit: b64('FIRST'), changes: { adds: [], removes: [] },
    });
    const body = {
      message: mlsMessageAt(ROOM, 1, 'never store this in push'),
      kind: 'text', forwarded: false, clientMessageId: 'push-db-message-01',
    };
    const first = await alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, body);
    const duplicate = await alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, body);
    assert.equal(duplicate.event_id, first.event_id);

    const queued = (await db.pool.query('SELECT * FROM push_deliveries')).rows;
    assert.equal(queued.length, 1, 'one durable delivery despite duplicate HTTP retry');
    assert.equal(queued[0].status, 'queued');
    const stored = JSON.stringify(queued[0]);
    assert.equal(stored.includes(FID), false);
    assert.equal(stored.includes(`/rooms/${ROOM}/events/`), false);
    assert.equal(sent.length, 0, 'request path does not call provider');

    await firstWorker.stop();
    const restartedWorker = createPushDelivery({ pool: db.pool, sender, encryptionKey, maxAttempts: 3 });
    try {
      await restartedWorker.tick();
      assert.equal(sent.length, 1);
      assert.equal(sent[0].fid, FID);
      assert.equal(sent[0].payload.event_id, first.event_id);
      const accepted = (await db.pool.query('SELECT status, provider_message_id FROM push_deliveries')).rows[0];
      assert.equal(accepted.status, 'provider_accepted');
      assert.match(accepted.provider_message_id, /messages\//);
    } finally {
      await restartedWorker.stop();
    }
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
    await firstWorker.stop().catch(() => {});
    await db.close();
  }
});
