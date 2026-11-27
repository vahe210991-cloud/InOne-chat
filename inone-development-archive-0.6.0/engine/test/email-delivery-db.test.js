import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createEmailDelivery, parseEmailEncryptionKey } from '../src/email-delivery.js';
import { testDatabase } from './helpers.js';
import { createStore } from '../src/store.js';
import { hashPin } from '../src/pin-security.js';

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
      sent.push({ to: message.to, subject: message.subject, text: message.text, html: message.html });
      return { messageId: 'test-message-id' };
    },
    close() { closed = true; },
  };
}

test('ключ шифрования требует ровно 32 байта', () => {
  assert.equal(parseEmailEncryptionKey('11'.repeat(32)).length, 32);
  assert.throws(() => parseEmailEncryptionKey(Buffer.alloc(16).toString('base64')), /exactly 32 bytes/);
  assert.throws(() => parseEmailEncryptionKey('not-base64!'), /valid base64/);
  const canonicalBase64 = randomBytes(32).toString('base64');
  assert.equal(parseEmailEncryptionKey(canonicalBase64).length, 32);
  assert.throws(() => parseEmailEncryptionKey(canonicalBase64.slice(0, -1)), /canonical base64/);
  assert.throws(() => parseEmailEncryptionKey(canonicalBase64 + '='), /canonical base64/);
});

test('очередь шифрует получателя и тело, дедуплицирует и восстанавливает доставку после перезапуска', async () => {
  const db = await testDatabase();
  const masterKey = randomBytes(32);
  const smtp1 = fakeSmtp();
  const first = createEmailDelivery({ pool: db.pool, smtpMailer: smtp1, encryptionKey: Buffer.from(masterKey), pollIntervalMs: 250 });
  const payload = { to: 'private-recipient@example.test', templateId: 'registration_code', variables: { code: 'SECRET-CODE-771155' }, locale: 'ru' };
  try {
    await assert.rejects(first.send({ to: payload.to, subject: 'Raw', text: 'body', idempotencyKey: 'raw-message-001' }), /templateId is required/);
    await assert.rejects(first.send({ to: payload.to, templateId: 'registration_code', variables: { code: '123456' }, idempotencyKey: 'missing-locale-001' }), /email locale is required/);
    const queued = await first.send({ ...payload, idempotencyKey: 'recovery-event-001' });
    assert.equal(queued.queued, true);
    assert.equal(queued.duplicate, false);
    const raw = (await db.pool.query('SELECT * FROM email_deliveries WHERE id = $1', [queued.deliveryId])).rows[0];
    const stored = JSON.stringify(raw);
    assert.ok(!stored.includes(payload.to));
    assert.ok(!stored.includes('InOne հաշվի հաստատման կոդը'));
    assert.ok(!stored.includes(payload.variables.code));
    assert.ok(!stored.includes('Noto Sans Armenian'));
    assert.ok(!stored.includes('doctype html'));
    assert.notEqual(raw.idempotency_key.trim(), createHash('sha256').update('recovery-event-001').digest('hex'));
    const duplicate = await first.send({ ...payload, idempotencyKey: 'recovery-event-001' });
    assert.equal(duplicate.duplicate, true);
    await assert.rejects(
      first.send({ ...payload, variables: { code: 'different payload' }, idempotencyKey: 'recovery-event-001' }),
      /reused with a different payload/,
    );
    await first.stop();

    const smtp2 = fakeSmtp();
    // The same encryption key is required to decrypt queued payloads.
    const recovered = createEmailDelivery({ pool: db.pool, smtpMailer: smtp2, encryptionKey: Buffer.from(masterKey), pollIntervalMs: 250 });
    recovered.start();
    await waitFor(async () => (await db.pool.query('SELECT status FROM email_deliveries WHERE id = $1', [queued.deliveryId])).rows[0].status === 'sent');
    assert.equal(smtp2.sent.length, 1);
    assert.equal(smtp2.sent[0].to, payload.to);
    assert.match(smtp2.sent[0].text, /SECRET-CODE-771155/);
    assert.match(smtp2.sent[0].html, /<html lang="ru">/);
    assert.match(smtp2.sent[0].html, /Noto Sans Armenian/);
    assert.match(smtp2.sent[0].html, /SECRET-CODE-771155/);
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
      to: 'private-recipient@example.test', templateId: 'registration_code', variables: { code: 'SECRET-CODE-998811' }, locale: 'hy',
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
        to: 'rollback@example.test', templateId: 'registration_code', variables: { code: 'ROLLBACK-CODE' }, locale: 'hy',
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
      to: 'commit@example.test', templateId: 'registration_code', variables: { code: 'COMMIT-CODE' }, locale: 'hy',
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
      to: 'recovery@example.test', templateId: 'registration_code', variables: { code: 'RECOVERY-LINK' }, locale: 'hy',
      idempotencyKey: 'recovery-transaction-001',
    }));
    assert.equal(recoveryIssued, true);
    assert.equal((await store.recoveryGet('@recovery-outbox')).reqCodeHash, 'recovery-code-hash');

    const identityExpiry = Date.now() + 60 * 60_000;
    const identitySentAt = Date.now();
    await store.recoveryUpdateWithOutbox('@recovery-outbox', (current) => ({
      next: {
        ...current,
        identityCheck: true,
        identityCodeHash: 'device-bound-identity-code-hash',
        identityAttempts: 2,
        identityCodeExpiresAt: identityExpiry,
        identityDeviceId: 'new-device',
        identityChallengeId: 'challenge-identity-001',
        identityLockedUntil: 0,
        identityLastSentAt: identitySentAt,
      },
      result: true,
    }), (tx) => queue.sendInTransaction(tx, {
      to: 'recovery@example.test',
      templateId: 'recovery_login_code',
      variables: { code: '123456' },
      locale: 'hy',
      idempotencyKey: 'identity-challenge-transaction-001',
    }));
    const persistedIdentity = await store.recoveryGet('@recovery-outbox');
    assert.equal(persistedIdentity.identityCodeHash, 'device-bound-identity-code-hash');
    assert.equal(persistedIdentity.identityAttempts, 2);
    assert.equal(persistedIdentity.identityCodeExpiresAt, identityExpiry);
    assert.equal(persistedIdentity.identityDeviceId, 'new-device');
    assert.equal(persistedIdentity.identityChallengeId, 'challenge-identity-001');
    assert.equal(persistedIdentity.identityLockedUntil, 0);
    assert.equal(persistedIdentity.identityLastSentAt, identitySentAt);

    const wait = await store.deviceWaitCreateWithOutbox({
      userId: '@recovery-outbox', deviceId: 'new-device', label: 'New device', platform: 'test',
      activateAt: Date.now() + 48 * 60 * 60_000, cancelHash: 'cancel-hash', createdAt: Date.now(),
    }, (tx) => queue.sendInTransaction(tx, {
      to: 'recovery@example.test', templateId: 'registration_code', variables: { code: 'DEVICE-CODE' }, locale: 'hy',
      idempotencyKey: 'device-wait-transaction-001',
    }));
    assert.equal(wait, 'ok');
    assert.equal((await store.deviceWaitGet('@recovery-outbox', 'new-device')).activateAt > Date.now(), true);

    await store.backupEmailSaveWithOutbox('@recovery-outbox', 'backup@example.test', Date.now(), (tx) =>
      queue.sendInTransaction(tx, { to: 'primary@example.test', templateId: 'backup_email_changed', variables: { action: 'added' }, locale: 'hy', idempotencyKey: 'backup-save-transaction-001' }));
    assert.equal((await store.backupEmailGet('@recovery-outbox')).email, 'backup@example.test');
    await store.backupEmailRemoveWithOutbox('@recovery-outbox', (tx) =>
      queue.sendInTransaction(tx, { to: 'primary@example.test', templateId: 'backup_email_removed', variables: {}, locale: 'hy', idempotencyKey: 'backup-remove-transaction-001' }));
    assert.equal(await store.backupEmailGet('@recovery-outbox'), null);

    await store.recoveryCancelSet('@recovery-outbox', 'old-cancel-hash', Date.now() + 60_000);
    await store.recoveryCancelWithOutbox('@recovery-outbox', 'restored-password-hash',
      (current) => ({ next: { ...current, reqStatus: 'cancelled' }, result: true }),
      (tx) => queue.sendInTransaction(tx, { to: 'primary@example.test', templateId: 'recovery_cancelled', variables: { method: 'code' }, locale: 'hy', idempotencyKey: 'recovery-cancel-transaction-001' }));
    assert.equal(await store.accountHash('@recovery-outbox'), 'restored-password-hash');
    assert.equal(await store.recoveryCancelGet('@recovery-outbox'), null);

    const newExpiry = Date.now() + 48 * 60 * 60_000;
    const completedAt = await store.recoveryCompleteWithOutbox('@recovery-outbox', 'new-password-hash',
      (current) => ({ next: { ...current, reqStatus: 'completed', windowKeyResetAt: newExpiry }, result: newExpiry }),
      'new-cancel-hash',
      (tx) => queue.sendInTransaction(tx, { to: 'primary@example.test', templateId: 'recovery_completed', variables: { cancelCode: 'RECOVERY-CANCEL' }, locale: 'hy', idempotencyKey: 'recovery-complete-transaction-001' }));
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
      to: 'retry@example.test', templateId: 'registration_code', variables: { code: 'RETRY-BODY' }, locale: 'hy',
      idempotencyKey: 'transient-retry-001',
    });
    queue.start();
    await waitFor(async () => (await db.pool.query('SELECT status FROM email_deliveries WHERE id = $1', [result.deliveryId])).rows[0].status === 'sent');
    const row = (await db.pool.query('SELECT attempts, last_error_code FROM email_deliveries WHERE id = $1', [result.deliveryId])).rows[0];
    assert.equal(row.attempts, 2);
    assert.equal(row.last_error_code, null);
    assert.equal(attempts, 2);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'retry@example.test');
    assert.match(sent[0].text, /RETRY-BODY/);
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
      to: 'expired@example.test', templateId: 'registration_code', variables: { code: 'EXPIRED-CODE' }, locale: 'hy',
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

test('длительная SMTP-отправка продлевает lease и не позволяет второму worker забрать запись', async () => {
  const db = await testDatabase();
  const key = randomBytes(32);
  let smtpStarted = false;
  let finishSmtp;
  const slowSmtp = {
    send() {
      smtpStarted = true;
      return new Promise((resolve) => { finishSmtp = resolve; });
    },
    close() {},
  };
  const first = createEmailDelivery({
    pool: db.pool, smtpMailer: slowSmtp, encryptionKey: Buffer.from(key),
    workerId: 'lease-owner-1', pollIntervalMs: 250, batchSize: 1,
    leaseMs: 600, leaseRenewIntervalMs: 100,
  });
  const secondSmtp = fakeSmtp();
  const second = createEmailDelivery({
    pool: db.pool, smtpMailer: secondSmtp, encryptionKey: Buffer.from(key),
    workerId: 'lease-owner-2', pollIntervalMs: 250, batchSize: 1,
    leaseMs: 600, leaseRenewIntervalMs: 100,
  });
  try {
    const queued = await first.send({
      to: 'lease@example.test', templateId: 'registration_code',
      variables: { code: 'LEASE-RENEWAL' }, locale: 'hy',
      idempotencyKey: 'lease-renewal-long-send-001',
    });
    first.start();
    await waitFor(() => smtpStarted);
    second.start();

    // More than two lease periods elapse while the first SMTP call is still pending.
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    const duringSend = (await db.pool.query(
      'SELECT status, locked_by FROM email_deliveries WHERE id = $1',
      [queued.deliveryId],
    )).rows[0];
    assert.equal(duringSend.status, 'processing');
    assert.equal(duringSend.locked_by, 'lease-owner-1');
    assert.equal(secondSmtp.sent.length, 0);

    finishSmtp({ messageId: 'long-send-message-id' });
    await waitFor(async () => (await db.pool.query(
      'SELECT status FROM email_deliveries WHERE id = $1',
      [queued.deliveryId],
    )).rows[0].status === 'sent');
    assert.equal(secondSmtp.sent.length, 0);
  } finally {
    finishSmtp?.({ messageId: 'cleanup-message-id' });
    await first.stop();
    await second.stop();
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
    const first = await queue.send({ to: 'first@example.test', templateId: 'registration_code', variables: { code: 'ONE' }, locale: 'hy', idempotencyKey: 'shutdown-first-001' });
    const second = await queue.send({ to: 'second@example.test', templateId: 'registration_code', variables: { code: 'TWO' }, locale: 'hy', idempotencyKey: 'shutdown-second-001' });
    queue.start();
    await waitFor(() => started);
    await queue.stop();
    assert.equal(closed, true);
    const rows = (await db.pool.query('SELECT id, status, attempts, locked_at, locked_by FROM email_deliveries WHERE id = ANY($1::bigint[]) ORDER BY id', [[first.deliveryId, second.deliveryId]])).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.status === 'queued'));
    assert.equal(Number(rows[0].attempts), 1, 'the in-flight SMTP send counts as one attempt');
    assert.equal(Number(rows[1].attempts), 0, 'a claimed but unsent message does not consume an attempt');
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
      to: 'tampered@example.test', templateId: 'registration_code', variables: { code: 'DO-NOT-SEND' }, locale: 'hy',
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

test('profile locale and pending registration locale persist in PostgreSQL', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: 'email-locale-store-test-pepper-0123456789' });
  try {
    const created = await store.createVerifiedAccount({
      userId: '@email-locale-db', passwordHash: 'password-hash',
      pinHash: await hashPin('email-locale-store-test-pepper-0123456789', '80421697'),
      phoneE164: '+37477000019', email: 'locale-db@example.test',
      nickname: 'LocaleDb', nowMs: Date.now(), locale: 'ru',
    });
    assert.equal(created, 'ok');
    assert.equal((await store.profileGet('@email-locale-db')).locale, 'ru');
    assert.equal(await store.profileLocaleSet('@email-locale-db', 'en'), true);
    assert.equal((await store.profileGet('@email-locale-db')).locale, 'en');
    await store.emailCodeUpdateWithOutbox('pending-locale@example.test', () => ({
      next: { codeHash: 'locale-code-hash', codeAttempts: 0, codeExpiresAt: Date.now() + 600_000, tokenHash: null, tokenExpiresAt: 0 },
      result: null,
    }), null, 'ru');
    assert.equal((await db.pool.query("SELECT locale FROM email_codes WHERE email = 'pending-locale@example.test'")).rows[0].locale, 'ru');
    const preservedLocale = await store.emailCodeUpdate('pending-locale@example.test', (current) => ({
      next: { ...current, tokenHash: 'one-time-token' }, result: current.locale,
    }));
    assert.equal(preservedLocale, 'ru');
    assert.equal((await db.pool.query("SELECT locale FROM email_codes WHERE email = 'pending-locale@example.test'")).rows[0].locale, 'ru');
  } finally {
    await db.close();
  }
});
