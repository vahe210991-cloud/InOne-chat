import { randomBytes } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createStore } from '../src/store.js';
import { createPushDelivery } from '../src/push-delivery.js';
import { FcmPushError } from '../src/fcm-push-sender.js';
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

test('PostgreSQL push outbox is atomic, encrypted, idempotent, retryable and lease-recoverable', async () => {
  const db = await testDatabase();
  const encryptionKey = randomBytes(32);
  const sent = [];
  let failNext = true;
  let permanentEventId = null;
  const sender = {
    async send(message) {
      sent.push(message);
      if (failNext) {
        failNext = false;
        throw new FcmPushError('provider_temporary', true);
      }
      if (message.payload.event_id === permanentEventId) {
        throw new FcmPushError('provider_permanent', false);
      }
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

    const queued = (await db.pool.query('SELECT * FROM push_deliveries ORDER BY id')).rows;
    assert.equal(queued.length, 1, 'one durable delivery despite duplicate HTTP retry');
    assert.equal(queued[0].status, 'queued');
    const stored = JSON.stringify(queued[0]);
    assert.equal(stored.includes(FID), false);
    assert.equal(stored.includes(`/rooms/${ROOM}/events/`), false);
    assert.equal(sent.length, 0, 'request path does not call provider');

    const secondMessage = await alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, {
      message: mlsMessageAt(ROOM, 1, 'second encrypted event'),
      kind: 'text', forwarded: false,
    });
    const permanentMessage = await alice.raw('POST', `/mls/groups/${enc(ROOM)}/messages`, {
      message: mlsMessageAt(ROOM, 1, 'third encrypted event'),
      kind: 'text', forwarded: false,
    });
    permanentEventId = permanentMessage.event_id;
    const deliveryRows = (await db.pool.query('SELECT id FROM push_deliveries ORDER BY id')).rows;
    assert.equal(deliveryRows.length, 3);
    await db.pool.query(
      `UPDATE push_deliveries SET status = 'processing', locked_at = now() - interval '5 minutes',
       locked_by = 'crashed-worker' WHERE id = $1`,
      [deliveryRows[1].id],
    );

    await firstWorker.stop();
    const restartedWorker = createPushDelivery({ pool: db.pool, sender, encryptionKey, maxAttempts: 3 });
    try {
      await restartedWorker.tick();
      assert.equal(sent.length, 3, 'restart recovers stale lease and processes queued deliveries');
      assert.equal(sent[0].fid, FID);
      assert.equal(sent[0].payload.event_id, first.event_id);
      assert.equal(sent[1].payload.event_id, secondMessage.event_id);
      assert.equal(sent[2].payload.event_id, permanentMessage.event_id);

      const afterFirstAttempt = (await db.pool.query(
        'SELECT id, status, attempts, provider_message_id FROM push_deliveries ORDER BY id',
      )).rows;
      assert.equal(afterFirstAttempt[0].status, 'failed', 'transient provider error schedules a retry');
      assert.equal(afterFirstAttempt[0].attempts, 1);
      assert.equal(afterFirstAttempt[1].status, 'provider_accepted', 'expired processing lease is recovered');
      assert.equal(afterFirstAttempt[2].status, 'dead', 'permanent provider rejection goes to dead-letter status');

      await db.pool.query('UPDATE push_deliveries SET available_at = now() WHERE id = $1', [afterFirstAttempt[0].id]);
      await restartedWorker.tick();
      assert.equal(sent.length, 4);
      assert.equal(sent[3].payload.event_id, first.event_id);
      const accepted = (await db.pool.query(
        'SELECT status, attempts, provider_message_id FROM push_deliveries WHERE id = $1',
        [afterFirstAttempt[0].id],
      )).rows[0];
      assert.equal(accepted.status, 'provider_accepted');
      assert.equal(accepted.attempts, 2);
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


test('late invalid-target from old FCM registration cannot cancel a new registration or its deliveries', async () => {
  const db = await testDatabase();
  const encryptionKey = randomBytes(32);
  const NEW_FID = 'ZyXwVu9876543210_-ZyXw';
  let releaseSend;
  let signalSendStarted;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const sendStarted = new Promise((resolve) => { signalSendStarted = resolve; });
  let mode = 'blocked_invalid';
  const sent = [];
  const sender = {
    async send(message) {
      sent.push(message);
      if (mode === 'blocked_invalid') {
        signalSendStarted();
        await sendGate;
        throw new FcmPushError('invalid_target', false);
      }
      return { messageId: `projects/test/messages/${sent.length}` };
    },
  };
  const worker = createPushDelivery({ pool: db.pool, sender, encryptionKey, batchSize: 10 });
  await worker.backfillLegacyRegistrations();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const app = createServer({
    defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false,
    pinPepper: PEPPER, store, pushDelivery: worker,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const alice = await ChatClient.create(base, `${ALICE}-race`, 'A_RACE', PW);
    const bob = await ChatClient.create(base, `${BOB}-race`, 'B_RACE', PW);
    const deviceKey = `${BOB}-race|B_RACE`;
    assert.equal((await put(base, bob, { provider: 'fcm', token: FID })).status, 200);
    const oldRegistration = (await db.pool.query(
      'SELECT token_ciphertext FROM push_tokens WHERE device_key = $1', [deviceKey],
    )).rows[0];

    const room = '!push-generation-race:inone.test';
    await alice.createRoom(room, [alice.userId, bob.userId]);
    await alice.raw('POST', `/mls/groups/${enc(room)}/commits`, {
      epoch: 0, commit: b64('GENERATION-RACE'), changes: { adds: [], removes: [] },
    });
    const first = await alice.raw('POST', `/mls/groups/${enc(room)}/messages`, {
      message: mlsMessageAt(room, 1, 'old registration event'),
      kind: 'text', forwarded: false,
    });

    const inFlight = worker.tick();
    await sendStarted;
    assert.equal((await put(base, bob, { provider: 'fcm', token: NEW_FID })).status, 200);
    const newRegistration = (await db.pool.query(
      'SELECT token_ciphertext FROM push_tokens WHERE device_key = $1', [deviceKey],
    )).rows[0];
    assert.notEqual(newRegistration.token_ciphertext.toString('hex'), oldRegistration.token_ciphertext.toString('hex'));

    const second = await alice.raw('POST', `/mls/groups/${enc(room)}/messages`, {
      message: mlsMessageAt(room, 1, 'new registration event'),
      kind: 'text', forwarded: false,
    });
    const beforeRelease = (await db.pool.query(
      'SELECT id, status, registration_generation FROM push_deliveries ORDER BY id',
    )).rows;
    assert.equal(beforeRelease.length, 2);
    assert.notEqual(beforeRelease[0].registration_generation, beforeRelease[1].registration_generation);

    releaseSend();
    await inFlight;
    const current = (await db.pool.query(
      'SELECT token_ciphertext FROM push_tokens WHERE device_key = $1', [deviceKey],
    )).rows[0];
    assert.equal(current.token_ciphertext.toString('hex'), newRegistration.token_ciphertext.toString('hex'),
      'late invalid-target did not delete the replacement registration');
    const afterInvalid = (await db.pool.query(
      'SELECT id, status, last_error_code FROM push_deliveries ORDER BY id',
    )).rows;
    assert.equal(afterInvalid[0].status, 'cancelled');
    assert.equal(afterInvalid[0].last_error_code, 'registration_rotated');
    assert.equal(afterInvalid[1].status, 'queued', 'delivery created for the new generation remains queued');

    mode = 'success';
    await worker.tick();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].fid, NEW_FID);
    assert.equal(sent[1].payload.event_id, second.event_id);
    const accepted = (await db.pool.query(
      'SELECT status FROM push_deliveries WHERE id = $1', [afterInvalid[1].id],
    )).rows[0];
    assert.equal(accepted.status, 'provider_accepted');
    assert.equal(sent[0].payload.event_id, first.event_id);
  } finally {
    releaseSend();
    await new Promise((resolve) => app.server.close(resolve));
    await worker.stop().catch(() => {});
    await db.close();
  }
});
