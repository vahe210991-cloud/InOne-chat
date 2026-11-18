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
