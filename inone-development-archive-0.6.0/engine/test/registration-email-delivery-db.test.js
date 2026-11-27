import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import { createServer } from '../src/server.js';
import { createSmtpMailer } from '../src/mail-smtp.js';
import { createEmailDelivery } from '../src/email-delivery.js';
import { createStore } from '../src/store.js';
import { testDatabase } from './helpers.js';

const PEPPER = randomBytes(32).toString('hex');
const PASSWORD = 'Registration-smoke-password-2026!';

function startSmtpSink() {
  const received = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, _session, callback) {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => {
        received.push(Buffer.concat(chunks).toString('utf8'));
        callback();
      });
    },
    logger: false,
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        received,
        port: server.server.address().port,
        stop: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function decodeMime(raw) {
  return raw.split(/\r\n--[^\r\n]+(?:--)?\r\n/g).map((part) => {
    const separator = part.indexOf('\r\n\r\n');
    if (separator < 0) return '';
    const headers = part.slice(0, separator);
    let body = part.slice(separator + 4).trim();
    if (/Content-Transfer-Encoding: base64/i.test(headers)) {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    }
    if (/Content-Transfer-Encoding: quoted-printable/i.test(headers)) {
      body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
      return Buffer.from(body, 'binary').toString('utf8').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ');
    }
    return body;
  }).join('\n');
}

async function waitFor(fn, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('SMTP delivery did not complete before timeout');
}

test('verified account registration sends its email code through PostgreSQL outbox and SMTP', async () => {
  const db = await testDatabase();
  const smtp = await startSmtpSink();
  const smtpMailer = createSmtpMailer({
    host: '127.0.0.1',
    port: smtp.port,
    requireTls: false,
    from: 'InOne <noreply@inone.example>',
    timeoutMs: 3000,
  });
  const delivery = createEmailDelivery({
    pool: db.pool,
    smtpMailer,
    encryptionKey: randomBytes(32),
    pollIntervalMs: 250,
    maxAttempts: 1,
  });
  const app = createServer({
    pinPepper: PEPPER,
    store: createStore({ pool: db.pool, pinPepper: PEPPER }),
    mailer: delivery,
    registrationMode: 'verified',
    requirePhone: false,
  });
  let listening = false;
  let base;

  try {
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', () => {
        listening = true;
        base = `http://127.0.0.1:${app.server.address().port}`;
        resolve();
      });
    });
    delivery.start();

    const startResponse = await fetch(`${base}/register/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'registration-smtp@example.test', locale: 'ru' }),
    });
    assert.equal(startResponse.status, 202);

    const raw = await waitFor(() => smtp.received[0]);
    const decoded = decodeMime(raw);
    assert.match(raw, /registration-smtp@example\.test/i);
    assert.match(decoded, /Ваш код подтверждения:/);
    const code = decoded.match(/Ваш код подтверждения:\s*(\d{6})/)?.[1];
    assert.ok(code, 'actual SMTP message contains the registration code');

    const confirmResponse = await fetch(`${base}/register/email/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'registration-smtp@example.test', code }),
    });
    assert.equal(confirmResponse.status, 200);
    const confirmed = await confirmResponse.json();
    assert.equal(typeof confirmed.registrationToken, 'string');
    assert.ok(confirmed.registrationToken.length >= 20);

    const registrationResponse = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'registration-smtp@example.test',
        registrationToken: confirmed.registrationToken,
        password: PASSWORD,
        nickname: `MailFlow${randomBytes(3).toString('hex')}`,
      }),
    });
    assert.equal(registrationResponse.status, 200);
    const registered = await registrationResponse.json();
    assert.equal(registered.verificationLevel, 1);
    assert.equal(typeof registered.userId, 'string');

    await waitFor(async () => (await delivery.stats()).sent === 1);
  } finally {
    if (listening) await new Promise((resolve) => app.server.close(resolve));
    await delivery.stop();
    await smtp.stop();
    await db.close();
  }
});

test('registration ticket is not consumed when account creation rolls back on nickname conflict', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const suffix = randomBytes(6).toString('hex');
  const existingEmail = `existing-${suffix}@example.test`;
  const newEmail = `new-${suffix}@example.test`;
  const ticketHash = `ticket-${suffix}`;
  const existingUserId = `@existing-${suffix}:inone.test`;
  const newUserId = `@new-${suffix}:inone.test`;

  try {
    assert.equal(await store.createVerifiedAccount({
      userId: existingUserId,
      passwordHash: 'existing-password-hash',
      email: existingEmail,
      nickname: `taken-${suffix}`,
      nowMs: 1,
    }), 'ok');

    await store.emailCodeUpdate(newEmail, (current) => ({
      next: { ...current, tokenHash: ticketHash, tokenExpiresAt: 10000 },
      result: null,
    }));
    const changeEmailCode = (current) => ({
      next: { ...current, tokenHash: null, tokenExpiresAt: 0 },
      result: {
        outcome: current.tokenHash === ticketHash && current.tokenExpiresAt > 2 ? 'ok' : 'none',
        locale: current.locale ?? 'hy',
      },
    });

    const rejected = await store.createVerifiedAccountWithEmailToken({
      email: newEmail,
      changeEmailCode,
      userId: newUserId,
      passwordHash: 'new-password-hash',
      nickname: `taken-${suffix}`,
      nowMs: 2,
    });
    assert.equal(rejected.outcome, 'ok');
    assert.equal(rejected.created, 'nickname');

    const retried = await store.createVerifiedAccountWithEmailToken({
      email: newEmail,
      changeEmailCode,
      userId: newUserId,
      passwordHash: 'new-password-hash',
      nickname: `available-${suffix}`,
      nowMs: 3,
    });
    assert.deepEqual(retried, { outcome: 'ok', created: 'ok', locale: 'hy' });

    const replay = await store.createVerifiedAccountWithEmailToken({
      email: newEmail,
      changeEmailCode,
      userId: `@replay-${suffix}:inone.test`,
      passwordHash: 'replay-password-hash',
      nickname: `replay-${suffix}`,
      nowMs: 4,
    });
    assert.equal(replay.outcome, 'none');
    assert.equal(replay.created, null);
  } finally {
    await db.close();
  }
});

test('PostgreSQL persists device-bound identity challenge lifecycle fields', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const suffix = randomBytes(6).toString('hex');
  const userId = `@identity-${suffix}:inone.test`;

  try {
    assert.equal(await store.createVerifiedAccount({
      userId,
      passwordHash: 'identity-password-hash',
      email: `identity-${suffix}@example.test`,
      nickname: `identity-${suffix}`,
      nowMs: 1,
    }), 'ok');

    await store.recoveryUpdate(userId, (current) => ({
      next: {
        ...current,
        identityCheck: true,
        identityCodeHash: 'identity-code-hash',
        identityAttempts: 2,
        identityCodeExpiresAt: 10000,
        identityDeviceId: 'device-1',
        identityChallengeId: 'challenge-1',
        identityLockedUntil: 20000,
        identityLastSentAt: 3000,
      },
      result: 'updated',
    }));
    let state = await store.recoveryGet(userId);
    assert.equal(state.identityCodeExpiresAt, 10000);
    assert.equal(state.identityDeviceId, 'device-1');
    assert.equal(state.identityChallengeId, 'challenge-1');
    assert.equal(state.identityLockedUntil, 20000);
    assert.equal(state.identityLastSentAt, 3000);

    await store.recoveryUpdateWithOutbox(
      userId,
      (current) => ({
        next: { ...current, identityAttempts: 3, identityLastSentAt: 4000 },
        result: 'outbox-transaction',
      }),
      async () => {},
    );
    state = await store.recoveryGet(userId);
    assert.equal(state.identityAttempts, 3);
    assert.equal(state.identityLastSentAt, 4000);
  } finally {
    await db.close();
  }
});


test('registration ticket and account creation roll back together after an injected profile-write failure', async () => {
  const db = await testDatabase();
  const store = createStore({ pool: db.pool, pinPepper: PEPPER });
  const suffix = randomBytes(6).toString('hex');
  const email = `atomic-${suffix}@example.test`;
  const userId = `@atomic-${suffix}:inone.test`;
  const nickname = `atomic-${suffix}`;
  const functionName = `fail_registration_profile_${suffix}`;
  const triggerName = `fail_registration_profile_trigger_${suffix}`;
  const ticketHash = `ticket-${suffix}`;

  const changeEmailCode = (current) => ({
    next: {
      ...current,
      tokenHash: null,
      tokenExpiresAt: 0,
    },
    result: {
      outcome: current.tokenHash === ticketHash && current.tokenExpiresAt > 10 ? 'ok' : 'none',
      locale: current.locale ?? 'hy',
    },
  });

  try {
    await store.emailCodeUpdate(email, (current) => ({
      next: { ...current, tokenHash: ticketHash, tokenExpiresAt: 1000, locale: 'hy' },
      result: true,
    }));

    await db.pool.query(`
      CREATE FUNCTION ${functionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.email = '${email}' THEN
          RAISE EXCEPTION 'injected profile insert failure' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await db.pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON profiles
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);

    await assert.rejects(
      store.createVerifiedAccountWithEmailToken({
        email,
        changeEmailCode,
        userId,
        passwordHash: 'atomic-password-hash',
        nickname,
        nowMs: 10,
      }),
      /injected profile insert failure/,
    );

    const retainedTicket = await store.emailCodeUpdate(email, (current) => ({
      next: current,
      result: current.tokenHash,
    }));
    assert.equal(retainedTicket, ticketHash, 'failed account creation must roll back ticket consumption');
    assert.equal(await store.userIdByEmail(email), null, 'failed transaction must not leave an account');

    await db.pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON profiles`);
    await db.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);

    const retried = await store.createVerifiedAccountWithEmailToken({
      email,
      changeEmailCode,
      userId,
      passwordHash: 'atomic-password-hash',
      nickname,
      nowMs: 10,
    });
    assert.deepEqual(retried, { outcome: 'ok', created: 'ok', locale: 'hy' });

    const replay = await store.createVerifiedAccountWithEmailToken({
      email,
      changeEmailCode,
      userId: `@atomic-replay-${suffix}:inone.test`,
      passwordHash: 'replay-password-hash',
      nickname: `atomic-replay-${suffix}`,
      nowMs: 11,
    });
    assert.equal(replay.outcome, 'none');
    assert.equal(replay.created, null);
  } finally {
    await db.pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON profiles`).catch(() => {});
    await db.pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => {});
    await db.close();
  }
});
