import { randomBytes } from 'node:crypto';
// Подтверждение действий над провайдерами (этап 2): пароль после привязки отключён, подтверждение — код с почты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createServer } from '../src/server.js';

const PEPPER = randomBytes(24).toString('hex');
const FIXTURE_1 = randomBytes(16).toString('hex');
const PW = 'длинный-пароль-1';
const PROVIDERS = {
  google: { clientIds: ['g-client.apps.googleusercontent.com'] },
  apple: { clientIds: ['ai.inone.app'] },
};
const trusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEYS = { keys: [{ ...trusted.publicKey.export({ format: 'jwk' }), kid: 'test-key-1', alg: 'RS256', use: 'sig' }] };
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);

function signToken(claims) {
  const header = b64({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' });
  const payload = b64(claims);
  return `${header}.${payload}.${createSign('RSA-SHA256').update(`${header}.${payload}`).sign(trusted.privateKey).toString('base64url')}`;
}
const googleClaims = (nonce, extra = {}) => ({
  iss: 'https://accounts.google.com', aud: 'g-client.apps.googleusercontent.com', sub: 'google-sub-anna',
  email: 'anna@gmail.test', email_verified: true, nonce, iat: nowSec(), exp: nowSec() + 600, ...extra,
});
const appleClaims = (nonce, extra = {}) => ({
  iss: 'https://appleid.apple.com', aud: 'ai.inone.app', sub: 'apple-sub-anna',
  email: 'anna.apple@privaterelay.appleid.com', email_verified: 'true', nonce, iat: nowSec(), exp: nowSec() + 600, ...extra,
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

const nonceOf = async (base) => (await call(base, 'POST', '/auth/nonce')).body.nonce;

async function providerSignIn(base, provider, claimsOf) {
  const nonce = await nonceOf(base);
  return call(base, 'POST', '/auth/provider/verify', { body: { provider, idToken: signToken(claimsOf(nonce)), nonce } });
}

async function registerByEmail(base, srv, email, nickname) {
  await call(base, 'POST', '/register/email', { body: { email, locale: 'ru' } });
  const code = srv.mailbox(email).filter((m) => m.templateId === 'registration_code').at(-1).text.match(/\b(\d{6})\b/)[1];
  const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code } });
  return call(base, 'POST', '/register', { body: { email, registrationToken: confirmed.body.registrationToken, password: PW, nickname } });
}

const loginByEmail = async (base, email, deviceId) =>
  (await call(base, 'POST', '/login', { body: { email, password: PW, deviceId } })).body.token;

/** Аккаунт, созданный через Google: регистрация и данные для входа подтверждением провайдера. */
async function newGoogleAccount(base) {
  const v = await providerSignIn(base, 'google', (n) => googleClaims(n));
  return (await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'Anna.G' } })).body;
}

/** Сессия такого аккаунта: вход подтверждением провайдера. */
async function sessionOf(base, account, deviceId = 'ANNA_PHONE') {
  return (await call(base, 'POST', '/login', { body: { userId: account.userId, proof: account.proof, deviceId } })).body.token;
}

const codeOf = (srv, email) =>
  srv.mailbox(email).filter((m) => m.templateId === 'stepup_code').at(-1).text.match(/\b(\d{6})\b/)[1];

async function emailStepUp(base, srv, email, token, action) {
  const started = await call(base, 'POST', '/stepup/email/start', { token, body: { action } });
  assert.equal(started.status, 202);
  const confirmed = await call(base, 'POST', '/stepup/email/confirm', { token, body: { action, code: codeOf(srv, email) } });
  assert.equal(confirmed.status, 200);
  return confirmed.body.stepupToken;
}

test('S1: для аккаунта с паролем подтверждение — пароль; код с почты не выдаётся', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const token = await loginByEmail(base, 'boris@example.test', 'BORIS_PHONE');
    const started = await call(base, 'POST', '/stepup/email/start', { token, body: { action: 'link-provider' } });
    assert.equal(started.status, 400, 'пока пароль активен, код не выдаётся');
    assert.equal(srv.mailbox('boris@example.test').filter((m) => m.templateId === 'stepup_code').length, 0);
  } finally {
    await stop();
  }
});

test('S2: код подтверждения привязан к действию: код отвязки не подходит для привязки', async () => {
  const { srv, base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const token = await sessionOf(base, anna);
    assert.equal((await call(base, 'POST', '/stepup/email/start', { token, body: { action: 'remove-provider' } })).status, 202);
    const code = codeOf(srv, 'anna@gmail.test');
    const wrong = await call(base, 'POST', '/stepup/email/confirm', { token, body: { action: 'link-provider', code } });
    assert.equal(wrong.status, 403, 'код другого действия не подходит');
    const right = await call(base, 'POST', '/stepup/email/confirm', { token, body: { action: 'remove-provider', code } });
    assert.equal(right.status, 200);
  } finally {
    await stop();
  }
});

test('S3: подтверждение привязано к действию и одноразовое', async () => {
  const { srv, base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const token = await sessionOf(base, anna);
    const linkToken = await emailStepUp(base, srv, 'anna@gmail.test', token, 'link-provider');
    const nonce = await nonceOf(base);
    const apple = await call(base, 'POST', '/account/providers', { token, body: { stepupToken: linkToken, provider: 'apple', nonce, idToken: signToken(appleClaims(nonce)) } });
    assert.equal(apple.status, 200);
    // Подтверждение, выданное для привязки, не отвязывает.
    const wrongToken = await emailStepUp(base, srv, 'anna@gmail.test', token, 'link-provider');
    const wrongAction = await call(base, 'POST', '/account/providers/remove', { token, body: { stepupToken: wrongToken, provider: 'apple' } });
    assert.equal(wrongAction.status, 403, 'подтверждение привязки не подходит для отвязки');
    // Подтверждение отвязки проходит один раз.
    const removeToken = await emailStepUp(base, srv, 'anna@gmail.test', token, 'remove-provider');
    const removed = await call(base, 'POST', '/account/providers/remove', { token, body: { stepupToken: removeToken, provider: 'apple' } });
    assert.equal(removed.status, 200);
    const again = await call(base, 'POST', '/account/providers/remove', { token, body: { stepupToken: removeToken, provider: 'apple' } });
    assert.equal(again.status, 403, 'повтор того же подтверждения не проходит');
  } finally {
    await stop();
  }
});

test('S4: код подтверждения действия истекает через 10 минут и блокируется после пяти неверных попыток', async () => {
  const { srv, base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const token = await sessionOf(base, anna);
    await call(base, 'POST', '/stepup/email/start', { token, body: { action: 'remove-provider' } });
    const old = codeOf(srv, 'anna@gmail.test');
    srv.advance(11 * 60_000);
    assert.equal((await call(base, 'POST', '/stepup/email/confirm', { token, body: { action: 'remove-provider', code: old } })).status, 410, 'код старше 10 минут');
    await call(base, 'POST', '/stepup/email/start', { token, body: { action: 'remove-provider' } });
    const fresh = codeOf(srv, 'anna@gmail.test');
    for (let i = 0; i < 4; i++) {
      assert.equal((await call(base, 'POST', '/stepup/email/confirm', { token, body: { action: 'remove-provider', code: '000000' } })).status, 403);
    }
    assert.equal((await call(base, 'POST', '/stepup/email/confirm', { token, body: { action: 'remove-provider', code: '000000' } })).status, 403, 'пятая попытка блокирует код');
    assert.equal((await call(base, 'POST', '/stepup/email/confirm', { token, body: { action: 'remove-provider', code: fresh } })).status, 404, 'после блокировки правильный код не работает');
  } finally {
    await stop();
  }
});

test('S5: запросы кода подтверждения не чаще пяти в час на аккаунт', async () => {
  const { srv, base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const token = await sessionOf(base, anna);
    for (let i = 0; i < 5; i++) {
      assert.equal((await call(base, 'POST', '/stepup/email/start', { token, body: { action: 'remove-provider' } })).status, 202);
    }
    assert.equal((await call(base, 'POST', '/stepup/email/start', { token, body: { action: 'remove-provider' } })).status, 429);
    assert.equal(srv.mailbox('anna@gmail.test').filter((m) => m.templateId === 'stepup_code').length, 5);
  } finally {
    await stop();
  }
});

test('S6: отвязка без подтверждения не проходит; последний способ входа не отвязывается', async () => {
  const { srv, base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const token = await sessionOf(base, anna);
    assert.equal((await call(base, 'POST', '/account/providers/remove', { token, body: { provider: 'google' } })).status, 403);
    const stepupToken = await emailStepUp(base, srv, 'anna@gmail.test', token, 'remove-provider');
    const last = await call(base, 'POST', '/account/providers/remove', { token, body: { stepupToken, provider: 'google' } });
    assert.equal(last.status, 409);
    assert.match(last.body.error, /last sign-in method/);
    const profile = await call(base, 'GET', '/profile', { token });
    assert.deepEqual(profile.body.providers, ['google']);
  } finally {
    await stop();
  }
});

test('S7: восстановление пароля для аккаунта с привязкой отказывает до любых изменений', async () => {
  const { base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const r = await call(base, 'POST', '/recovery/complete', { body: { userId: anna.userId, code: '000000', newPassword: FIXTURE_1 } });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /disabled for accounts linked/);
    const login = await call(base, 'POST', '/login', { body: { userId: anna.userId, password: FIXTURE_1, deviceId: 'ANNA_LAPTOP' } });
    assert.equal(login.status, 401, 'новый пароль не входит');
  } finally {
    await stop();
  }
});
