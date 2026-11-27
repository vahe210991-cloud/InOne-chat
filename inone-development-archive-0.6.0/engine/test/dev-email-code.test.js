import { randomBytes } from 'node:crypto';
// Режим разработки: фиксированный код подтверждения почты. Работает только в разработке и не принимается в продакшене.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

const PEPPER = randomBytes(24).toString('hex');
const GOOD = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x/y', INONE_PIN_PEPPER: 'q8Lw2rT6vN1zXc4bH9mK0pJs7dFg5aYe', INONE_PUBLIC_URL: 'https://inone.example', INONE_MAIL_TRANSPORT: 'smtp', INONE_SMTP_HOST: 'smtp.provider.test', INONE_SMTP_FROM: 'InOne <noreply@inone.example>' };

async function start(devEmailCode) {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'verified', requirePhone: false, pinPepper: PEPPER, devEmailCode });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${srv.server.address().port}`, stop: () => new Promise((r) => srv.server.close(r)) };
}

async function confirm(base, email, code) {
  const r = await fetch(`${base}/register/email/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) });
  return r.status;
}

test('в разработке фиксированный код подтверждения принимается, после запроса кода', async () => {
  const { base, stop } = await start('000000');
  try {
    await fetch(`${base}/register/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.test' }) });
    assert.equal(await confirm(base, 'owner@example.test', '000000'), 200);
  } finally {
    await stop();
  }
});

test('без настройки фиксированный код не принимается', async () => {
  const { base, stop } = await start('');
  try {
    await fetch(`${base}/register/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.test' }) });
    assert.notEqual(await confirm(base, 'owner@example.test', '000000'), 200);
  } finally {
    await stop();
  }
});

test('в продакшене фиксированный код запрещён, а не-шестизначный — тоже', () => {
  assert.throws(() => loadConfig({ ...GOOD, INONE_DEV_EMAIL_CODE: '000000' }), /not allowed in production/);
  assert.throws(() => loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost/x', INONE_DEV_EMAIL_CODE: '12345' }), /must be 6 digits/);
  assert.equal(loadConfig({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost/x', INONE_DEV_EMAIL_CODE: '000000' }).devEmailCode, '000000');
});

test('existing and unknown emails have the same registration-confirmation response without a ticket', async () => {
  const { base, stop } = await start('000000');
  try {
    const requestCode = await fetch(`${base}/register/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.test' }),
    });
    assert.equal(requestCode.status, 202);
    const confirmed = await fetch(`${base}/register/email/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.test', code: '000000' }),
    });
    assert.equal(confirmed.status, 200);
    const ticket = await confirmed.json();
    const created = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@example.test',
        registrationToken: ticket.registrationToken,
        password: 'correct-horse-battery',
        nickname: 'owner-account',
      }),
    });
    assert.equal(created.status, 200);

    const [existing, unknown] = await Promise.all([
      fetch(`${base}/register/email/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.test', code: '000000' }),
      }),
      fetch(`${base}/register/email/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.test', code: '000000' }),
      }),
    ]);
    assert.equal(existing.status, 404);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await existing.json(), await unknown.json());
  } finally {
    await stop();
  }
});
