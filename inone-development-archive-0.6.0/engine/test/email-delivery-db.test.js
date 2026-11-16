import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createEmailDelivery, parseEmailEncryptionKey } from '../src/email-delivery.js';
import { testDatabase } from './helpers.js';
import { createStore } from '../src/store.js';

async function waitFor(fn, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('condition was not reached before timeout');
}

function fakeSmtp({ failReason = null } = {}) {
  const sent = [];
  let closed = false;
  return {
    sent,
    get closed() { return closed; },
    async send(message) {
      if (failReason) {
        const error = new Error('mail transport unavailable');
        error.reason = failReason;
        throw error;
      }
      sent.push({ to: message.to, subject: message.subject, text: message.text });
      return { messageId: 'test-message-id' };
    },
    close() { closed = true; },
  };
}

test('ключ шифрования требует ровно 32 байта', () => {
  assert.equal(parseEmailEncryptionKey('11'.repeat(32)).length, 32);
  assert.throws(() => parseEmailEncryptionKey('short'), /exactly 32 bytes/);
});

test('очередь шифрует получателя и тело, дедуплицирует и восстанавливает доставку после перезапуска', async () => {
  const db = await testDatabase();
  const masterKey = randomBytes(32);
  const smtp1 = fakeSmtp();
  const first = createEmailDelivery({ pool: db.pool, smtpMailer: smtp1, encryptionKey: Buffer.from(masterKey), pollIntervalMs: 250 });
  const payload = { to: 'private-recipient@example.test', subject: 'Recovery', text: 'SECRET-CODE-771155' };
  try {
    const queued = await first.send({ ...payload, idempotencyKey: 'recovery-event-001' });
    assert.equal(queued.queued, true);
    assert.equal(queued.duplicate, false);
    const raw = (await db.pool.query('SELECT * FROM email_deliveries WHERE id = $1', [queued.deliveryId])).rows[0];
    const stored = JSON.stringify(raw);
    assert.ok(!stored.includes(payload.to));
    assert.ok(!stored.includes(payload.subject));
    assert.ok(!stored.includes(payload.text));
    assert.notEqual(raw.idempotency_key.trim(), createHash('sha256').update('recovery-event-001').digest('hex'));
    const duplicate = await first.send({ ...payload, idempotencyKey: 'recovery-event-001' });
    assert.equal(duplicate.duplicate, true);
    await assert.rejects(
      first.send({ ...payload, text: 'different payload', idempotencyKey: 'recovery-event-001' }),
      /reused with a different payload/,
    );
    await first.stop();

    const smtp2 = fakeSmtp();
    // The same encryption key is required to decrypt queued payloads.
    const recovered = createEmailDelivery({ pool: db.pool, smtpMailer: smtp2, encryptionKey: Buffer.from(masterKey), pollIntervalMs: 250 });
    recovered.start();
    await waitFor(async () => (await db.pool.query('SELECT status FROM email_deliveries WHERE id = $1', [queued.deliveryId])).rows[0].status === 'sent');
    assert.deepEqual(smtp2.sent, [payload]);
    await recovered.stop();
    assert.equal(smtp2.closed, true);
  } finally {
    await db.close();
  }
});

test('постоянная SMTP-ошибка переводит доставку в dead letter без утечки содержимого', async () => {
  const db = await testDatabase();
  const smtp = fakeSmtp({ failReason: 'auth' });
  const logs = [];
  const logger = { info: (m, f) => logs.push([m, f]), warn: (m, f) => logs.push([m, f]), error: (m, f) => logs.push([m, f]) };
  const queue = createEmailDelivery({ pool: db.pool, smtpMailer: smtp, encryptionKey: randomBytes(32), logger, pollIntervalMs: 250 });
  try {
    const result = await queue.send({
      to: 'private-recipient@example.test', subject: 'Auth', text: 'SECRET-CODE-998811',
      idempotencyKey: 'auth-failure-001',
    });
    queue.start();
    await waitFor(async () => (await db.pool.query('SELECT status FROM email_deliveries WHERE id = $1', [result.deliveryId])).rows[0].status === 'dead');
    const row = (await db.pool.query('SELECT attempts, last_error_code FROM email_deliveries WHERE id = $1', [result.deliveryId])).rows[0];
    assert.equal(row.attempts, 1);
    assert.equal(row.last_error_code, 'auth');
    assert.ok(!JSON.stringify(logs).includes('private-recipient@example.test'));
    assert.ok(!JSON.stringify(logs).includes('SECRET-CODE-998811'));
  } finally {
    await queue.stop();
    await db.close();
  }
});

test('код и durable email outbox коммитятся и откатываются одной PostgreSQL-транзакцией', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: 'atomic-outbox-test-pepper-0123456789' });
  const queue = createEmailDelivery({ pool: db.pool, smtpMailer: fakeSmtp(), encryptionKey: randomBytes(32) });
  try {
    await assert.rejects(store.emailCodeUpdateWithOutbox('rollback@example.test', () => ({
      next: { codeHash: 'code-hash', codeAttempts: 0, codeExpiresAt: Date.now() + 600_000, tokenHash: null, tokenExpiresAt: 0 },
      result: true,
    }), async (tx) => {
      await queue.sendInTransaction(tx, {
        to: 'rollback@example.test', subject: 'Code', text: 'ROLLBACK-CODE',
        idempotencyKey: 'atomic-rollback-001',
      });
      throw new Error('force transaction rollback');
    }), /force transaction rollback/);
    assert.equal((await db.pool.query("SELECT count(*)::int AS count FROM email_codes WHERE email = 'rollback@example.test'")).rows[0].count, 0);
    assert.equal((await db.pool.query("SELECT count(*)::int AS count FROM email_deliveries")).rows[0].count, 0);

    await store.emailCodeUpdateWithOutbox('commit@example.test', () => ({
      next: { codeHash: 'committed-code-hash', codeAttempts: 0, codeExpiresAt: Date.now() + 600_000, tokenHash: null, tokenExpiresAt: 0 },
      result: true,
    }), (tx) => queue.sendInTransaction(tx, {
      to: 'commit@example.test', subject: 'Code', text: 'COMMIT-CODE',
      idempotencyKey: 'atomic-commit-001',
    }));
    assert.equal((await db.pool.query("SELECT code_hash FROM email_codes WHERE email = 'commit@example.test'")).rows[0].code_hash, 'committed-code-hash');
    assert.equal((await db.pool.query("SELECT count(*)::int AS count FROM email_deliveries")).rows[0].count, 1);
  } finally {
    await queue.stop();
    await db.close();
  }
});

test('recovery state and new-device wait are committed with their email outbox rows', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: 'atomic-outbox-test-pepper-0123456789' });
  const queue = createEmailDelivery({ pool: db.pool, smtpMailer: fakeSmtp(), encryptionKey: randomBytes(32) });
  try {
    await store.addAccount('@recovery-outbox', 'password-hash');
    const recoveryIssued = await store.recoveryUpdateWithOutbox('@recovery-outbox', (current) => ({
      next: { ...current, reqStatus: 'pending', reqStartedAt: Date.now(), reqExpiresAt: Date.now() + 3_600_000, reqCodeHash: 'recovery-code-hash' },
      result: true,
    }), (tx) => queue.sendInTransaction(tx, {
      to: 'recovery@example.test', subject: 'Recovery', text: 'RECOVERY-LINK',
      idempotencyKey: 'recovery-transaction-001',
    }));
    assert.equal(recoveryIssued, true);
    assert.equal((await store.recoveryGet('@recovery-outbox')).reqCodeHash, 'recovery-code-hash');

    const wait = await store.deviceWaitCreateWithOutbox({
      userId: '@recovery-outbox', deviceId: 'new-device', label: 'New device', platform: 'test',
      activateAt: Date.now() + 48 * 60 * 60_000, cancelHash: 'cancel-hash', createdAt: Date.now(),
    }, (tx) => queue.sendInTransaction(tx, {
      to: 'recovery@example.test', subject: 'Device wait', text: 'DEVICE-CODE',
      idempotencyKey: 'device-wait-transaction-001',
    }));
    assert.equal(wait, 'ok');
    assert.equal((await store.deviceWaitGet('@recovery-outbox', 'new-device')).activateAt > Date.now(), true);

    await store.backupEmailSaveWithOutbox('@recovery-outbox', 'backup@example.test', Date.now(), (tx) =>
      queue.sendInTransaction(tx, { to: 'primary@example.test', subject: 'Backup added', text: 'NOTICE', idempotencyKey: 'backup-save-transaction-001' }));
    assert.equal((await store.backupEmailGet('@recovery-outbox')).email, 'backup@example.test');
    await store.backupEmailRemoveWithOutbox('@recovery-outbox', (tx) =>
      queue.sendInTransaction(tx, { to: 'primary@example.test', subject: 'Backup removed', text: 'NOTICE', idempotencyKey: 'backup-remove-transaction-001' }));
    assert.equal(await store.backupEmailGet('@recovery-outbox'), null);

    await store.recoveryCancelSet('@recovery-outbox', 'old-cancel-hash', Date.now() + 60_000);
    await store.recoveryCancelWithOutbox('@recovery-outbox', 'restored-password-hash',
      (current) => ({ next: { ...current, reqStatus: 'cancelled' }, result: true }),
      (tx) => queue.sendInTransaction(tx, { to: 'primary@example.test', subject: 'Recovery cancelled', text: 'NOTICE', idempotencyKey: 'recovery-cancel-transaction-001' }));
    assert.equal(await store.accountHash('@recovery-outbox'), 'restored-password-hash');
    assert.equal(await store.recoveryCancelGet('@recovery-outbox'), null);

    const newExpiry = Date.now() + 48 * 60 * 60_000;
    const completedAt = await store.recoveryCompleteWithOutbox('@recovery-outbox', 'new-password-hash',
      (current) => ({ next: { ...current, reqStatus: 'completed', windowKeyResetAt: newExpiry }, result: newExpiry }),
      'new-cancel-hash',
      (tx) => queue.sendInTransaction(tx, { to: 'primary@example.test', subject: 'Recovery completed', text: 'NOTICE', idempotencyKey: 'recovery-complete-transaction-001' }));
    assert.equal(completedAt, newExpiry);
    assert.equal(await store.accountHash('@recovery-outbox'), 'new-password-hash');
    assert.equal((await store.recoveryCancelGet('@recovery-outbox')).codeHash, 'new-cancel-hash');
    assert.equal((await db.pool.query('SELECT count(*)::int AS count FROM email_deliveries')).rows[0].count, 6);
  } finally {
    await queue.stop();
    await db.close();
  }
});

test('временная SMTP-ошибка повторяется с backoff и затем доставляется', async () => {
  const db = await testDatabase();
  let attempts = 0;
  const sent = [];
  const smtp = {
    async send(message) {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('temporary connection failure');
        error.reason = 'connection';
        throw error;
      }
      sent.push({ to: message.to, subject: message.subject, text: message.text });
      return { messageId: 'retried-message-id' };
    },
    close() {},
  };
  const queue = createEmailDelivery({
    pool: db.pool, smtpMailer: smtp, encryptionKey: randomBytes(32),
    pollIntervalMs: 250, retryBaseMs: 100, retryMaxMs: 500,
  });
  try {
    const result = await queue.send({
      to: 'retry@example.test', subject: 'Retry', text: 'RETRY-BODY',
      idempotencyKey: 'transient-retry-001',
    });
    queue.start();
    await waitFor(async () => (await db.pool.query('SELECT status FROM email_deliveries WHERE id = $1', [result.deliveryId])).rows[0].status === 'sent');
    const row = (await db.pool.query('SELECT attempts, last_error_code FROM email_deliveries WHERE id = $1', [result.deliveryId])).rows[0];
    assert.equal(row.attempts, 2);
    assert.equal(row.last_error_code, null);
    assert.equal(attempts, 2);
    assert.deepEqual(sent, [{ to: 'retry@example.test', subject: 'Retry', text: 'RETRY-BODY' }]);
  } finally {
    await queue.stop();
    await db.close();
  }
});

test('истёкшее сообщение переводится в dead letter и не отправляется', async () => {
  const db = await testDatabase();
  const smtp = fakeSmtp();
  const queue = createEmailDelivery({ pool: db.pool, smtpMailer: smtp, encryptionKey: randomBytes(32), pollIntervalMs: 250 });
  try {
    const result = await queue.send({
      to: 'expired@example.test', subject: 'Expired', text: 'EXPIRED-CODE',
      idempotencyKey: 'expired-email-001',
    });
    await db.pool.query("UPDATE email_deliveries SET expires_at = now() - interval '1 second' WHERE id = $1", [result.deliveryId]);
    queue.start();
    await waitFor(async () => (await db.pool.query('SELECT status FROM email_deliveries WHERE id = $1', [result.deliveryId])).rows[0].status === 'dead');
    assert.equal(smtp.sent.length, 0);
    assert.equal((await db.pool.query('SELECT last_error_code FROM email_deliveries WHERE id = $1', [result.deliveryId])).rows[0].last_error_code, 'expired');
  } finally {
    await queue.stop();
    await db.close();
  }
});

test('graceful shutdown закрывает SMTP и освобождает незавершённые leases', async () => {
  const db = await testDatabase();
  let rejectActive;
  let started = false;
  let closed = false;
  const smtp = {
    send() {
      started = true;
      return new Promise((resolve, reject) => { rejectActive = reject; });
    },
    close() {
      closed = true;
      const error = new Error('transport closed during shutdown');
      error.reason = 'connection';
      rejectActive?.(error);
    },
  };
  const queue = createEmailDelivery({
    pool: db.pool, smtpMailer: smtp, encryptionKey: randomBytes(32),
    pollIntervalMs: 250, batchSize: 2, retryBaseMs: 100, retryMaxMs: 500,
  });
  try {
    const first = await queue.send({ to: 'first@example.test', subject: 'One', text: 'ONE', idempotencyKey: 'shutdown-first-001' });
    const second = await queue.send({ to: 'second@example.test', subject: 'Two', text: 'TWO', idempotencyKey: 'shutdown-second-001' });
    queue.start();
    await waitFor(() => started);
    await queue.stop();
    assert.equal(closed, true);
    const rows = (await db.pool.query('SELECT id, status, locked_at, locked_by FROM email_deliveries WHERE id = ANY($1::bigint[]) ORDER BY id', [[first.deliveryId, second.deliveryId]])).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.status === 'queued'));
    assert.ok(rows.every((row) => row.locked_at === null && row.locked_by === null));
  } finally {
    await queue.stop();
    await db.close();
  }
});

test('повреждённый AES-GCM payload переводится в dead letter без отправки', async () => {
  const db = await testDatabase();
  const smtp = fakeSmtp();
  const queue = createEmailDelivery({ pool: db.pool, smtpMailer: smtp, encryptionKey: randomBytes(32), pollIntervalMs: 250 });
  try {
    const result = await queue.send({
      to: 'tampered@example.test', subject: 'Integrity', text: 'DO-NOT-SEND',
      idempotencyKey: 'payload-tamper-001',
    });
    await db.pool.query(
      'UPDATE email_deliveries SET payload_tag = set_byte(payload_tag, 0, (get_byte(payload_tag, 0) + 1) % 256) WHERE id = $1',
      [result.deliveryId],
    );
    queue.start();
    await waitFor(async () => (await db.pool.query('SELECT status FROM email_deliveries WHERE id = $1', [result.deliveryId])).rows[0].status === 'dead');
    assert.equal(smtp.sent.length, 0);
    assert.equal((await db.pool.query('SELECT last_error_code FROM email_deliveries WHERE id = $1', [result.deliveryId])).rows[0].last_error_code, 'payload_integrity');
  } finally {
    await queue.stop();
    await db.close();
  }
});
