import { randomBytes } from 'node:crypto';
// Восстановление по почте (этап 3, решение владельца): аккаунт без телефона — одна почта и окно 48 часов;
// аккаунт с привязкой Google или Apple — вход через провайдера, кода восстановления нет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createServer } from '../src/server.js';

const PEPPER = randomBytes(24).toString('hex');
const PW = 'длинный-пароль-1';
const NEW_PW = 'новый-пароль-2';
const PROVIDERS = {
  google: { clientIds: ['g-client.apps.googleusercontent.com'] },
  apple: { clientIds: ['ai.inone.app'] },
};
const trusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEYS = { keys: [{ ...trusted.publicKey.export({ format: 'jwk' }), kid: 'test-key-1', alg: 'RS256', use: 'sig' }] };
const HOUR = 3600_000;
const SUBJECT_RECOVERY = 'recovery_code';
const SUBJECT_DONE = 'recovery_completed';
const SUBJECT_IDENTITY = 'recovery_login_code';
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
  await call(base, 'POST', '/register/email', { body: { email, locale: 'ru' } });
  const code = srv.mailbox(email).filter((m) => m.templateId === 'registration_code').at(-1).text.match(/\b(\d{6})\b/)[1];
  const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code } });
  return call(base, 'POST', '/register', { body: { email, registrationToken: confirmed.body.registrationToken, password: PW, nickname } });
}

const identityChallenges = new Map();

async function loginWith(base, email, password, deviceId, identityCode) {
  const key = `${email}|${deviceId}`;
  const challengeId = identityCode ? identityChallenges.get(key) : undefined;
  const result = await call(base, 'POST', '/login', {
    body: {
      email,
      password,
      deviceId,
      ...(identityCode ? { identityCode } : {}),
      ...(identityCode && challengeId ? { identityChallengeId: challengeId } : {}),
    },
  });
  if (result.body.status === 'identity_check_required' && typeof result.body.challengeId === 'string') {
    identityChallenges.set(key, result.body.challengeId);
  } else if (result.status === 200 && identityCode) {
    identityChallenges.delete(key);
  }
  return result;
}

const codeOf = (srv, mailbox, subject, pattern = /\b(\d{6})\b/) =>
  srv.mailbox(mailbox).filter((m) => m.templateId === subject).at(-1).text.match(pattern)[1];

/** Восстановление по почте до конца: запрос, верный код, новый пароль. Возвращает код отмены. */
async function completedRecovery(base, srv, email, newPassword = NEW_PW) {
  assert.equal((await call(base, 'POST', '/recovery/start', { body: { email } })).status, 202);
  const code = codeOf(srv, email, SUBJECT_RECOVERY);
  const done = await call(base, 'POST', '/recovery/complete', { body: { email, code, newPassword } });
  assert.equal(done.status, 200);
  return codeOf(srv, email, SUBJECT_DONE, /кода: (\d{6})/);
}

test('R-E1: восстановление по почте — код уходит на почту аккаунта; неизвестная почта не получает ничего', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    assert.equal((await call(base, 'POST', '/recovery/start', { body: { email: 'boris@example.test' } })).status, 202);
    const recoveryMail = srv.mailbox('boris@example.test').filter((m) => m.templateId === 'recovery_code').at(-1);
    assert.ok(recoveryMail, 'recovery code email is delivered');
    assert.match(recoveryMail.text, /\b\d{6}\b/, 'recovery code is included in the email');
    assert.equal(recoveryMail.locale, 'ru');
    const notification = srv.mailbox('boris@example.test').filter((m) => m.templateId === 'recovery_requested').at(-1);
    assert.ok(notification, 'recovery request notification is delivered');
    assert.equal(notification.locale, 'ru');
    assert.equal(srv.mailbox('boris@example.test').filter((m) => m.templateId === SUBJECT_RECOVERY).length, 1);
    assert.equal((await call(base, 'POST', '/recovery/start', { body: { email: 'nobody@example.test' } })).status, 202, 'ответ одинаковый');
    assert.equal(srv.mailbox('nobody@example.test').length, 0);
  } finally {
    await stop();
  }
});

test('R-E2: неверный код не меняет пароль; верный меняет и выдаёт код отмены', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    await call(base, 'POST', '/recovery/start', { body: { email: 'boris@example.test' } });
    const code = codeOf(srv, 'boris@example.test', SUBJECT_RECOVERY);
    assert.equal((await call(base, 'POST', '/recovery/complete', { body: { email: 'boris@example.test', code: '000000', newPassword: NEW_PW } })).status, 403);
    assert.equal((await call(base, 'POST', '/recovery/complete', { body: { email: 'boris@example.test', code, newPassword: NEW_PW } })).status, 200);
    assert.match(codeOf(srv, 'boris@example.test', SUBJECT_DONE, /кода: (\d{6})/), /^\d{6}$/);
  } finally {
    await stop();
  }
});

test('R-E3: в окне 48 часов новое устройство не добавляется; старый пароль уже не действует', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    await completedRecovery(base, srv, 'boris@example.test');
    const inWindow = await loginWith(base, 'boris@example.test', NEW_PW, 'BORIS_TABLET');
    assert.equal(inWindow.status, 403, 'в окне новое устройство не добавляется');
    assert.equal((await loginWith(base, 'boris@example.test', PW, 'BORIS_TABLET')).status, 401, 'старый пароль не действует');
  } finally {
    await stop();
  }
});

test('R-E4: после окна первый вход с нового устройства требует код с почты', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    await completedRecovery(base, srv, 'boris@example.test');
    srv.advance(49 * HOUR);
    const asked = await loginWith(base, 'boris@example.test', NEW_PW, 'BORIS_TABLET');
    assert.equal(asked.status, 202);
    assert.equal(asked.body.status, 'identity_check_required');
    const code = codeOf(srv, 'boris@example.test', SUBJECT_IDENTITY);
    assert.equal((await loginWith(base, 'boris@example.test', NEW_PW, 'BORIS_TABLET', '000000')).status, 403, 'неверный код не пускает');
    assert.equal((await loginWith(base, 'boris@example.test', NEW_PW, 'BORIS_TABLET', code)).status, 200);
  } finally {
    await stop();
  }
});

test('R-E5: отмена кодом из письма в окне возвращает прежний пароль; неверный код не отменяет', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const cancelCode = await completedRecovery(base, srv, 'boris@example.test');
    assert.equal((await call(base, 'POST', '/recovery/cancel-by-code', { body: { email: 'boris@example.test', code: '000000' } })).status, 403);
    assert.equal((await call(base, 'POST', '/recovery/cancel-by-code', { body: { email: 'boris@example.test', code: cancelCode } })).status, 200);
    assert.equal((await loginWith(base, 'boris@example.test', PW, 'BORIS_TABLET')).status, 200, 'прежний пароль снова действует');
  } finally {
    await stop();
  }
});

test('R-E6: аккаунт с привязкой Google — кода восстановления нет; смена пароля отказана', async () => {
  const { srv, base, stop } = await start();
  try {
    const nonce = (await call(base, 'POST', '/auth/nonce')).body.nonce;
    const v = await call(base, 'POST', '/auth/provider/verify', { body: { provider: 'google', idToken: signToken(googleClaims(nonce)), nonce } });
    const anna = (await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'Anna.G' } })).body;
    assert.equal((await call(base, 'POST', '/recovery/start', { body: { email: 'anna@gmail.test' } })).status, 202);
    assert.equal(srv.mailbox('anna@gmail.test').filter((m) => m.templateId === SUBJECT_RECOVERY).length, 0, 'кода для аккаунта с Google нет');
    const r = await call(base, 'POST', '/recovery/complete', { body: { userId: anna.userId, code: '000000', newPassword: NEW_PW } });
    assert.equal(r.status, 409);
  } finally {
    await stop();
  }
});

test('R-E7: пока код восстановления жив, новый код не выдаётся; после срока — выдаётся', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    for (let i = 0; i < 4; i++) {
      assert.equal((await call(base, 'POST', '/recovery/start', { body: { email: 'boris@example.test' } })).status, 202);
    }
    assert.equal(srv.mailbox('boris@example.test').filter((m) => m.templateId === SUBJECT_RECOVERY).length, 1, 'один живой код, без спама');
    srv.advance(61 * 60_000);
    assert.equal((await call(base, 'POST', '/recovery/start', { body: { email: 'boris@example.test' } })).status, 202);
    assert.equal(srv.mailbox('boris@example.test').filter((m) => m.templateId === SUBJECT_RECOVERY).length, 2, 'после срока код выдаётся заново');
  } finally {
    await stop();
  }
});

test('R-E8: попытки отмены кодом ограничены десятью в час на адрес', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    await completedRecovery(base, srv, 'boris@example.test');
    for (let i = 0; i < 10; i++) {
      assert.equal((await call(base, 'POST', '/recovery/cancel-by-code', { body: { email: 'boris@example.test', code: '000000' } })).status, 403);
    }
    assert.equal((await call(base, 'POST', '/recovery/cancel-by-code', { body: { email: 'boris@example.test', code: '000000' } })).status, 429);
  } finally {
    await stop();
  }
});
