import { randomBytes } from 'node:crypto';
// Отложенный вход (решение владельца): без активных устройств вход с нового устройства ждёт 48 часов
// для аккаунта только с почтой; для аккаунта с привязкой Google или Apple — сразу.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createServer } from '../src/server.js';

const PEPPER = randomBytes(24).toString('hex');
const PW = 'длинный-пароль-1';
const PROVIDERS = {
  google: { clientIds: ['g-client.apps.googleusercontent.com'] },
  apple: { clientIds: ['ai.inone.app'] },
};
const trusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEYS = { keys: [{ ...trusted.publicKey.export({ format: 'jwk' }), kid: 'test-key-1', alg: 'RS256', use: 'sig' }] };
const HOUR = 3600_000;
const SUBJECT_WAIT = 'Вход с нового устройства: ожидание 48 часов';
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);

function signToken(claims) {
  const header = b64({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' });
  const payload = b64(claims);
  return `${header}.${payload}.${createSign('RSA-SHA256').update(`${header}.${payload}`).sign(trusted.privateKey).toString('base64url')}`;
}
const googleClaims = (nonce) => ({
  iss: 'https://accounts.google.com', aud: 'g-client.apps.googleusercontent.com', sub: 'google-sub-anna',
  email: 'anna@gmail.test', email_verified: true, nonce, iat: nowSec(), exp: nowSec() + 600,
});

async function start() {
  const srv = createServer({ defaultOrgAutoJoin: true, pinPepper: PEPPER, providers: PROVIDERS, providerKeysSource: async () => KEYS });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: () => new Promise((r) => srv.server.close(r)) };
}

async function call(base, method, path, { body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function registerByEmail(base, srv, email, nickname) {
  await call(base, 'POST', '/register/email', { body: { email } });
  const code = srv.mailbox(email).filter((m) => m.subject === 'Код подтверждения InOne').at(-1).text.match(/Код: (\d{6})/)[1];
  const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code } });
  return call(base, 'POST', '/register', { body: { email, registrationToken: confirmed.body.registrationToken, password: PW, nickname } });
}

const loginByEmail = (base, email, deviceId) => call(base, 'POST', '/login', { body: { email, password: PW, deviceId } });
const revokeDevice = (base, token, deviceId) => call(base, 'DELETE', `/devices/${deviceId}`, { token });
const codeFromWait = (srv, mailbox) =>
  srv.mailbox(mailbox).filter((m) => m.subject === SUBJECT_WAIT).at(-1).text.match(/отмените вход кодом (\d{6})/)[1];

/** Аккаунт только с почтой: первое устройство сразу, затем оно отключено, и новое устройство ждёт. */
async function emailAccountWaiting(base, srv) {
  await registerByEmail(base, srv, 'boris@example.test', 'Boris');
  const first = await loginByEmail(base, 'boris@example.test', 'BORIS_PHONE');
  assert.equal(first.status, 200, 'первое устройство нового аккаунта — сразу');
  assert.equal((await revokeDevice(base, first.body.token, 'BORIS_PHONE')).status, 200);
  const waiting = await loginByEmail(base, 'boris@example.test', 'BORIS_TABLET');
  assert.equal(waiting.status, 202);
  assert.equal(waiting.body.status, 'waiting_period');
  return waiting;
}

test('D1: аккаунт только с почтой без активных устройств — вход с нового устройства ждёт 48 часов; уведомление с кодом отмены', async () => {
  const { srv, base, stop } = await start();
  try {
    await emailAccountWaiting(base, srv);
    assert.ok(srv.mailbox('boris@example.test').some((m) => m.subject === SUBJECT_WAIT), 'уведомление отправлено');
    assert.match(codeFromWait(srv, 'boris@example.test'), /^\d{6}$/);
  } finally {
    await stop();
  }
});

test('D2: до истечения 48 часов вход не открывается; после — открывается тем же запросом', async () => {
  const { srv, base, stop } = await start();
  try {
    await emailAccountWaiting(base, srv);
    srv.advance(47 * HOUR);
    assert.equal((await loginByEmail(base, 'boris@example.test', 'BORIS_TABLET')).status, 202, 'через 47 часов ещё ждём');
    srv.advance(2 * HOUR);
    const opened = await loginByEmail(base, 'boris@example.test', 'BORIS_TABLET');
    assert.equal(opened.status, 200, 'через 49 часов вход открыт');
    assert.ok(opened.body.token);
  } finally {
    await stop();
  }
});

test('D3: отмена входа по коду из письма; неверный код не отменяет', async () => {
  const { srv, base, stop } = await start();
  try {
    await emailAccountWaiting(base, srv);
    const code = codeFromWait(srv, 'boris@example.test');
    assert.equal((await call(base, 'POST', '/admission/cancel', { body: { email: 'boris@example.test', code: '000000' } })).status, 403, 'неверный код не отменяет');
    assert.equal((await call(base, 'POST', '/admission/cancel', { body: { email: 'boris@example.test', code } })).status, 200);
    srv.advance(49 * HOUR);
    assert.equal((await loginByEmail(base, 'boris@example.test', 'BORIS_TABLET')).status, 202, 'после отмены ожидание начинается заново');
  } finally {
    await stop();
  }
});

test('D4: аккаунт с привязкой Google — вход с нового устройства без активных устройств сразу', async () => {
  const { base, stop } = await start();
  try {
    const nonce0 = (await call(base, 'POST', '/auth/nonce')).body.nonce;
    const v0 = await call(base, 'POST', '/auth/provider/verify', { body: { provider: 'google', idToken: signToken(googleClaims(nonce0)), nonce: nonce0 } });
    const anna = (await call(base, 'POST', '/register/provider', { body: { ticket: v0.body.ticket, nickname: 'Anna.G' } })).body;
    const first = await call(base, 'POST', '/login', { body: { userId: anna.userId, proof: anna.proof, deviceId: 'ANNA_PHONE' } });
    assert.equal(first.status, 200);
    assert.equal((await revokeDevice(base, first.body.token, 'ANNA_PHONE')).status, 200);
    const nonce1 = (await call(base, 'POST', '/auth/nonce')).body.nonce;
    const v1 = await call(base, 'POST', '/auth/provider/verify', { body: { provider: 'google', idToken: signToken(googleClaims(nonce1)), nonce: nonce1 } });
    assert.equal(v1.body.status, 'linked');
    const again = await call(base, 'POST', '/login', { body: { userId: anna.userId, proof: v1.body.proof, deviceId: 'ANNA_TABLET' } });
    assert.equal(again.status, 200, 'с привязкой — сразу, без ожидания');
  } finally {
    await stop();
  }
});

test('D5: уведомление о ожидании уходит и на запасную почту', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const token = (await loginByEmail(base, 'boris@example.test', 'BORIS_PHONE')).body.token;
    assert.equal((await call(base, 'POST', '/account/backup-email/start', { token, body: { email: 'backup@example.test', password: PW } })).status, 202);
    const code = srv.mailbox('backup@example.test').filter((m) => m.subject === 'Подтверждение запасной почты InOne').at(-1).text.match(/Код: (\d{6})/)[1];
    assert.equal((await call(base, 'POST', '/account/backup-email/confirm', { token, body: { email: 'backup@example.test', code } })).status, 200);
    assert.equal((await revokeDevice(base, token, 'BORIS_PHONE')).status, 200);
    assert.equal((await loginByEmail(base, 'boris@example.test', 'BORIS_TABLET')).status, 202);
    assert.ok(srv.mailbox('backup@example.test').some((m) => m.subject === SUBJECT_WAIT), 'запасная почта получила уведомление');
  } finally {
    await stop();
  }
});

test('D6: попытки отмены ограничены десятью в час на адрес', async () => {
  const { srv, base, stop } = await start();
  try {
    await emailAccountWaiting(base, srv);
    for (let i = 0; i < 10; i++) {
      assert.equal((await call(base, 'POST', '/admission/cancel', { body: { email: 'boris@example.test', code: '000000' } })).status, 403);
    }
    assert.equal((await call(base, 'POST', '/admission/cancel', { body: { email: 'boris@example.test', code: '000000' } })).status, 429);
  } finally {
    await stop();
  }
});
