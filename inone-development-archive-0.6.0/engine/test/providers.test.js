import { randomBytes } from 'node:crypto';
// Этап 2 модели аккаунта: вход и регистрация через Google и Apple (спецификация IDENTITY_MODEL_2026-10-21.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, createSign } from 'node:crypto';
import { createServer } from '../src/server.js';

const PEPPER = randomBytes(24).toString('hex');
const PW = 'длинный-пароль-1';
const PIN = '80421697';
const PHONE = '+37477000031';
const PROVIDERS = {
  google: { clientIds: ['g-client.apps.googleusercontent.com'] },
  apple: { clientIds: ['ai.inone.app'] },
};

// Ключи провайдера для тестов: настоящая пара RSA; публичная часть отдаётся как JWKS.
const trusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEYS = { keys: [{ ...trusted.publicKey.export({ format: 'jwk' }), kid: 'test-key-1', alg: 'RS256', use: 'sig' }] };

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
const nowSec = () => Math.floor(Date.now() / 1000);

function signToken(claims, { key = trusted.privateKey, kid = 'test-key-1' } = {}) {
  const header = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const payload = b64(claims);
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(key).toString('base64url');
  return `${header}.${payload}.${signature}`;
}
const googleClaims = (nonce, extra = {}) => ({
  iss: 'https://accounts.google.com', aud: 'g-client.apps.googleusercontent.com', sub: 'google-sub-anna',
  email: 'anna@gmail.test', email_verified: true, nonce, iat: nowSec(), exp: nowSec() + 600, ...extra,
});
const appleClaims = (nonce, extra = {}) => ({
  iss: 'https://appleid.apple.com', aud: 'ai.inone.app', sub: 'apple-sub-boris',
  email: 'boris@privaterelay.appleid.com', email_verified: 'true', nonce, iat: nowSec(), exp: nowSec() + 600, ...extra,
});

async function start(extra = {}) {
  const srv = createServer({ defaultOrgAutoJoin: true, pinPepper: PEPPER, providers: PROVIDERS, providerKeysSource: async () => KEYS, ...extra });
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

/** Вход через провайдера: свой nonce, свой токен, проверка на сервере. */
async function providerSignIn(base, provider, claimsOf, tokenOptions = {}) {
  const nonce = await nonceOf(base);
  const idToken = signToken(claimsOf(nonce), tokenOptions);
  return call(base, 'POST', '/auth/provider/verify', { body: { provider, idToken, nonce } });
}

async function registerByEmail(base, srv, email, nickname) {
  await call(base, 'POST', '/register/email', { body: { email, locale: 'ru' } });
  const code = srv.mailbox(email).filter((m) => m.templateId === 'registration_code').at(-1).text.match(/\b(\d{6})\b/)[1];
  const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code } });
  return call(base, 'POST', '/register', { body: { email, registrationToken: confirmed.body.registrationToken, password: PW, nickname, phone: PHONE, pin: PIN, pinConfirmation: PIN } });
}

const loginByEmail = async (base, email, deviceId) =>
  (await call(base, 'POST', '/login', { body: { email, password: PW, deviceId } })).body.token;

async function emailStepUp(base, srv, email, token, action) {
  const started = await call(base, 'POST', '/stepup/email/start', { token, body: { action } });
  assert.equal(started.status, 202);
  const code = srv.mailbox(email).filter((m) => m.templateId === 'stepup_code').at(-1).text.match(/\b(\d{6})\b/)[1];
  const confirmed = await call(base, 'POST', '/stepup/email/confirm', { token, body: { action, code } });
  assert.equal(confirmed.status, 200);
  return confirmed.body.stepupToken;
}

/** Новый аккаунт через Google: вход, билет, регистрация с ником. */
async function newGoogleAccount(base, nickname = 'Anna.G') {
  const v = await providerSignIn(base, 'google', (n) => googleClaims(n));
  return (await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname, phone: PHONE, pin: PIN, pinConfirmation: PIN } })).body;
}

test('P1: вход через Google для нового пользователя — билет, ник, уровень 2, вход без пароля', async () => {
  const { base, stop } = await start();
  try {
    const v = await providerSignIn(base, 'google', (n) => googleClaims(n));
    assert.equal(v.status, 200);
    assert.equal(v.body.status, 'new');
    assert.equal(v.body.email, 'anna@gmail.test');
    const reg = await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'Anna.G', phone: PHONE, pin: PIN, pinConfirmation: PIN } });
    assert.equal(reg.status, 200);
    assert.equal(reg.body.verificationLevel, 2);
    const login = await call(base, 'POST', '/login', { body: { userId: reg.body.userId, proof: reg.body.proof, deviceId: 'ANNA_PHONE' } });
    assert.equal(login.status, 200, 'первый вход по подтверждению провайдера');
    const byPassword = await call(base, 'POST', '/login', { body: { userId: reg.body.userId, password: PW, deviceId: 'ANNA_LAPTOP' } });
    assert.equal(byPassword.status, 401, 'у аккаунта провайдера пароля нет');
  } finally {
    await stop();
  }
});

test('P2: повторный вход через Google возвращает того же пользователя; подтверждение одноразовое и только для своего аккаунта', async () => {
  const { srv, base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const again = await providerSignIn(base, 'google', (n) => googleClaims(n));
    assert.equal(again.body.status, 'linked');
    assert.equal(again.body.userId, anna.userId);
    const boris = await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const forBoris = await providerSignIn(base, 'google', (n) => googleClaims(n));
    const wrongAccount = await call(base, 'POST', '/login', { body: { userId: boris.body.userId, proof: forBoris.body.proof, deviceId: 'BORIS_PHONE' } });
    assert.equal(wrongAccount.status, 401, 'подтверждение Анны не открывает аккаунт Бориса');
    const forAnna = await providerSignIn(base, 'google', (n) => googleClaims(n));
    const ok = await call(base, 'POST', '/login', { body: { userId: anna.userId, proof: forAnna.body.proof, deviceId: 'ANNA_PHONE' } });
    assert.equal(ok.status, 200);
    const reused = await call(base, 'POST', '/login', { body: { userId: anna.userId, proof: forAnna.body.proof, deviceId: 'ANNA_PHONE' } });
    assert.equal(reused.status, 401, 'подтверждение одноразовое');
  } finally {
    await stop();
  }
});

test('P3: токен провайдера проверяется полностью — аудитория, издатель, срок, подпись, алгоритм, nonce, почта', async () => {
  const { base, stop } = await start();
  try {
    const cases = [
      ['чужая аудитория', (n) => googleClaims(n, { aud: 'someone-else.apps.googleusercontent.com' }), 401],
      ['чужой издатель', (n) => googleClaims(n, { iss: 'https://evil.example' }), 401],
      ['истёкший токен', (n) => googleClaims(n, { exp: nowSec() - 10 }), 401],
      ['почта не подтверждена', (n) => googleClaims(n, { email_verified: false }), 403],
      ['в токене нет nonce', (n) => { const c = googleClaims(n); delete c.nonce; return c; }, 401],
      ['чужой nonce', () => googleClaims('not-issued-by-us'), 401],
    ];
    for (const [name, claimsOf, status] of cases) {
      const r = await providerSignIn(base, 'google', claimsOf);
      assert.equal(r.status, status, name);
    }
    const forgedNonce = await nonceOf(base);
    const forged = await call(base, 'POST', '/auth/provider/verify', {
      body: { provider: 'google', idToken: signToken(googleClaims(forgedNonce), { key: stranger.privateKey }), nonce: forgedNonce },
    });
    assert.equal(forged.status, 401, 'подпись чужим ключом');
    const unknownNonce = await nonceOf(base);
    const unknownKid = await call(base, 'POST', '/auth/provider/verify', {
      body: { provider: 'google', idToken: signToken(googleClaims(unknownNonce), { kid: 'nobody' }), nonce: unknownNonce },
    });
    assert.equal(unknownKid.status, 401, 'неизвестный ключ');
    const noneNonce = await nonceOf(base);
    const noneToken = `${b64({ alg: 'none', kid: 'test-key-1', typ: 'JWT' })}.${b64(googleClaims(noneNonce))}.`;
    const none = await call(base, 'POST', '/auth/provider/verify', { body: { provider: 'google', idToken: noneToken, nonce: noneNonce } });
    assert.equal(none.status, 401, 'алгоритм none не принимается');
    const nonce = await nonceOf(base);
    const token = signToken(googleClaims(nonce));
    assert.equal((await call(base, 'POST', '/auth/provider/verify', { body: { provider: 'google', idToken: token, nonce } })).status, 200);
    assert.equal((await call(base, 'POST', '/auth/provider/verify', { body: { provider: 'google', idToken: token, nonce } })).status, 401, 'повтор nonce не принимается');
  } finally {
    await stop();
  }
});

test('P4: Apple — почта подтверждена строкой "true", nonce принимается сырым и в виде SHA-256, relay-адрес помечается', async () => {
  const { base, stop } = await start();
  try {
    const hashed = await providerSignIn(base, 'apple', (n) => appleClaims(sha256Hex(n)));
    assert.equal(hashed.status, 200, 'SHA-256 от nonce');
    assert.equal(hashed.body.status, 'new');
    assert.equal(hashed.body.relay, true);
    const raw = await providerSignIn(base, 'apple', (n) => appleClaims(n, { sub: 'apple-sub-raw' }));
    assert.equal(raw.status, 200, 'сырой nonce');
  } finally {
    await stop();
  }
});

test('P5: один внешний аккаунт — один аккаунт InOne: чужой Google не привязывается', async () => {
  const { srv, base, stop } = await start();
  try {
    await newGoogleAccount(base, 'Anna.G');
    const boris = await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    assert.equal(boris.status, 200);
    const token = await loginByEmail(base, 'boris@example.test', 'BORIS_PHONE');
    const nonce = await nonceOf(base);
    const linked = await call(base, 'POST', '/account/providers', {
      token, body: { password: PW, provider: 'google', nonce, idToken: signToken(googleClaims(nonce)) },
    });
    assert.equal(linked.status, 409);
    assert.match(linked.body.error, /another InOne account/);
  } finally {
    await stop();
  }
});

test('P6: привязка требует пароль; после привязки пароль отключён; второй провайдер — по коду с почты; повтор — уже привязан', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const token = await loginByEmail(base, 'boris@example.test', 'BORIS_PHONE');
    const nonce1 = await nonceOf(base);
    const noPassword = await call(base, 'POST', '/account/providers', { token, body: { provider: 'apple', nonce: nonce1, idToken: signToken(appleClaims(nonce1)) } });
    assert.equal(noPassword.status, 403, 'без пароля привязка не проходит');
    const nonce2 = await nonceOf(base);
    const linked = await call(base, 'POST', '/account/providers', { token, body: { password: PW, provider: 'apple', nonce: nonce2, idToken: signToken(appleClaims(nonce2)) } });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.verificationLevel, 2);
    assert.deepEqual(linked.body.providers, ['apple']);
    assert.equal((await call(base, 'GET', '/profile', { token })).body.email, 'boris@example.test');
    // После привязки пароль не входит, даже верный.
    assert.equal((await call(base, 'POST', '/login', { body: { email: 'boris@example.test', password: PW, deviceId: 'BORIS_LAPTOP' } })).status, 401);
    // Пароль после привязки не принимается и для подтверждения.
    const nonce3 = await nonceOf(base);
    const noCode = await call(base, 'POST', '/account/providers', { token, body: { password: PW, provider: 'google', nonce: nonce3, idToken: signToken(googleClaims(nonce3, { sub: 'google-sub-boris', email: 'boris@gmail.test' })) } });
    assert.equal(noCode.status, 403, 'пароль после привязки не принимается');
    // Второй провайдер — только по коду с почты.
    const stepupToken = await emailStepUp(base, srv, 'boris@example.test', token, 'link-provider');
    const nonce4 = await nonceOf(base);
    const google = await call(base, 'POST', '/account/providers', { token, body: { stepupToken, provider: 'google', nonce: nonce4, idToken: signToken(googleClaims(nonce4, { sub: 'google-sub-boris', email: 'boris@gmail.test' })) } });
    assert.equal(google.status, 200);
    assert.deepEqual(google.body.providers, ['apple', 'google']);
    // Повтор того же провайдера — уже привязан (с новым подтверждением).
    const again = await emailStepUp(base, srv, 'boris@example.test', token, 'link-provider');
    const nonce5 = await nonceOf(base);
    const repeat = await call(base, 'POST', '/account/providers', { token, body: { stepupToken: again, provider: 'apple', nonce: nonce5, idToken: signToken(appleClaims(nonce5)) } });
    assert.equal(repeat.status, 409);
    assert.match(repeat.body.error, /already linked/);
  } finally {
    await stop();
  }
});

test('P7: почта, уже занятая аккаунтом с паролем, не отдаётся входу через провайдер', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'anna@gmail.test', 'Anna.Mail');
    const v = await providerSignIn(base, 'google', (n) => googleClaims(n, { sub: 'google-sub-second' }));
    assert.equal(v.body.status, 'new');
    const reg = await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'Anna.Two', phone: PHONE, pin: PIN, pinConfirmation: PIN } });
    assert.equal(reg.status, 409);
    assert.match(reg.body.error, /email already registered/);
  } finally {
    await stop();
  }
});

test('P8: Sign in with Apple обязателен вместе с Google (правило App Store 4.8)', () => {
  assert.throws(() => createServer({ defaultOrgAutoJoin: true, pinPepper: PEPPER, providers: { google: { clientIds: ['g'] } } }), /Sign in with Apple/);
  assert.doesNotThrow(() => createServer({ defaultOrgAutoJoin: true, pinPepper: PEPPER, providers: { google: { clientIds: ['g'] }, apple: { clientIds: ['a'] } } }));
  assert.doesNotThrow(() => createServer({ defaultOrgAutoJoin: true, pinPepper: PEPPER }));
});

test('P9: отвязка — по коду с почты; последний способ входа не отвязывается; отвязанный провайдер не связан с аккаунтом', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const token = await loginByEmail(base, 'boris@example.test', 'BORIS_PHONE');
    const nonce1 = await nonceOf(base);
    const apple = await call(base, 'POST', '/account/providers', { token, body: { password: PW, provider: 'apple', nonce: nonce1, idToken: signToken(appleClaims(nonce1)) } });
    assert.equal(apple.status, 200);
    const linkToken = await emailStepUp(base, srv, 'boris@example.test', token, 'link-provider');
    const nonce2 = await nonceOf(base);
    const google = await call(base, 'POST', '/account/providers', { token, body: { stepupToken: linkToken, provider: 'google', nonce: nonce2, idToken: signToken(googleClaims(nonce2, { sub: 'google-sub-boris', email: 'boris@gmail.test' })) } });
    assert.equal(google.status, 200);
    assert.equal((await call(base, 'POST', '/account/providers/remove', { token, body: { provider: 'apple' } })).status, 403, 'без подтверждения не отвязывается');
    const removeToken = await emailStepUp(base, srv, 'boris@example.test', token, 'remove-provider');
    const removed = await call(base, 'POST', '/account/providers/remove', { token, body: { stepupToken: removeToken, provider: 'apple' } });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.providers, ['google']);
    assert.equal(removed.body.verificationLevel, 2);
    // Последний способ входа отвязать нельзя.
    const lastToken = await emailStepUp(base, srv, 'boris@example.test', token, 'remove-provider');
    const last = await call(base, 'POST', '/account/providers/remove', { token, body: { stepupToken: lastToken, provider: 'google' } });
    assert.equal(last.status, 409);
    assert.match(last.body.error, /last sign-in method/);
    // Отвязанный Apple снова не связан с аккаунтом.
    const nonce3 = await nonceOf(base);
    const unlinked = await call(base, 'POST', '/auth/provider/verify', { body: { provider: 'apple', nonce: nonce3, idToken: signToken(appleClaims(nonce3)) } });
    assert.equal(unlinked.body.status, 'new');
  } finally {
    await stop();
  }
});

test('P10: билет регистрации одноразовый; ошибка в нике не сжигает билет', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const v = await providerSignIn(base, 'google', (n) => googleClaims(n));
    assert.equal((await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'ab', phone: PHONE, pin: PIN, pinConfirmation: PIN } })).status, 400);
    assert.equal((await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'boris' } })).status, 409, 'ник занят');
    const ok = await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'Anna.G' } });
    assert.equal(ok.status, 200, 'билет пережил ошибки в нике');
    assert.equal((await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'Anna.Two' } })).status, 403, 'второй раз билет не принимается');
  } finally {
    await stop();
  }
});

test('P11: поиск показывает уровень 2 у аккаунта с Google; почта другим не отдаётся', async () => {
  const { srv, base, stop } = await start();
  try {
    await newGoogleAccount(base, 'Anna.G');
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const token = await loginByEmail(base, 'boris@example.test', 'BORIS_PHONE');
    const found = await call(base, 'GET', '/users/search?nickname=anna.g', { token });
    assert.equal(found.status, 200);
    assert.equal(found.body.verificationLevel, 2);
    assert.equal(JSON.stringify(found.body).includes('anna@gmail.test'), false);
    const own = await call(base, 'GET', '/profile', { token });
    assert.equal(own.body.verificationLevel, 1, 'у Бориса только почта');
  } finally {
    await stop();
  }
});

test('P12: недоступность JWKS не раскрывает ошибку провайдера и возвращает временный 503', async () => {
  const { base, stop } = await start({ providerKeysSource: async () => { throw new Error('private jwks endpoint sentinel'); } });
  try {
    const nonce = await nonceOf(base);
    const response = await call(base, 'POST', '/auth/provider/verify', {
      body: { provider: 'google', idToken: signToken(googleClaims(nonce)), nonce },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'identity provider verification is temporarily unavailable' });
    assert.ok(!JSON.stringify(response.body).includes('private jwks endpoint sentinel'));
  } finally {
    await stop();
  }
});
