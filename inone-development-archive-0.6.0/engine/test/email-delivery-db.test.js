import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createEmailDelivery, parseEmailEncryptionKey } from '../src/email-delivery.js';
import { testDatabase } from './helpers.js';

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
