import { randomBytes } from 'node:crypto';
// Этап 2 на PostgreSQL: связь с Google переживает перезапуск; один внешний аккаунт — один аккаунт на уровне базы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createServer } from '../src/server.js';
import { createStore } from '../src/store.js';
import { testDatabase } from './helpers.js';

const dbTest = process.env.DATABASE_URL ? test : test.skip;
const PEPPER = randomBytes(24).toString('hex');
const PW = 'длинный-пароль-1';
const PIN = '80421697';
const PHONE = '+37477000032';
const PROVIDERS = { google: { clientIds: ['g-client.apps.googleusercontent.com'] }, apple: { clientIds: ['ai.inone.app'] } };
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

async function serve(store) {
  const srv = createServer({ defaultOrgAutoJoin: true, pinPepper: PEPPER, store, trustProxy: true, providers: PROVIDERS, providerKeysSource: async () => KEYS });
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

async function providerSignIn(base, claimsOf) {
  const nonce = (await call(base, 'POST', '/auth/nonce')).body.nonce;
  return call(base, 'POST', '/auth/provider/verify', { body: { provider: 'google', idToken: signToken(claimsOf(nonce)), nonce } });
}

async function registerByEmail(base, srv, email, nickname) {
  await call(base, 'POST', '/register/email', { body: { email, locale: 'ru' } });
  const code = srv.mailbox(email).filter((m) => m.templateId === 'registration_code').at(-1).text.match(/\b(\d{6})\b/)[1];
  const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code } });
  return call(base, 'POST', '/register', { body: { email, registrationToken: confirmed.body.registrationToken, password: PW, nickname, phone: PHONE, pin: PIN, pinConfirmation: PIN } });
}

dbTest('SD25: связь с Google переживает перезапуск; один внешний аккаунт — один аккаунт на базе', async () => {
  const db = await testDatabase();
  try {
    const first = await serve(createStore({ pool: db.pool, pinPepper: PEPPER }));
    const v = await providerSignIn(first.base, (n) => googleClaims(n));
    const anna = await call(first.base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'Anna.G', phone: PHONE, pin: PIN, pinConfirmation: PIN } });
    assert.equal(anna.status, 200);
    await first.stop();

    let borisId;
    const second = await serve(createStore({ pool: db.pool, pinPepper: PEPPER }));
    try {
      const again = await providerSignIn(second.base, (n) => googleClaims(n));
      assert.equal(again.body.status, 'linked', 'после перезапуска связь на месте');
      assert.equal(again.body.userId, anna.body.userId);
      const boris = await registerByEmail(second.base, second.srv, 'boris@example.test', 'Boris');
      assert.equal(boris.status, 200);
      borisId = boris.body.userId;
    } finally {
      await second.stop();
    }

    const direct = createStore({ pool: db.pool, pinPepper: PEPPER });
    assert.equal(await direct.linkProvider({ userId: borisId, provider: 'google', sub: 'google-sub-anna', email: 'anna@gmail.test', nowMs: 0 }), 'taken', 'чужой внешний аккаунт не привязывается');
    assert.equal(await direct.linkProvider({ userId: anna.body.userId, provider: 'google', sub: 'google-sub-second', email: 'anna@gmail.test', nowMs: 0 }), 'provider-set', 'второй Google тому же аккаунту не добавляется');
    assert.equal(await direct.linkProvider({ userId: anna.body.userId, provider: 'google', sub: 'google-sub-anna', email: 'anna@gmail.test', nowMs: 0 }), 'provider-set', 'повтор той же привязки — уже привязан');
  } finally {
    await db.close();
  }
});

dbTest('SD26: после привязки пароль отключён и остаётся отключённым после перезапуска', async () => {
  const db = await testDatabase();
  try {
    const first = await serve(createStore({ pool: db.pool, pinPepper: PEPPER }));
    await registerByEmail(first.base, first.srv, 'boris@example.test', 'Boris');
    const token = (await call(first.base, 'POST', '/login', { body: { email: 'boris@example.test', password: PW, deviceId: 'BORIS_PHONE' } })).body.token;
    const nonce = (await call(first.base, 'POST', '/auth/nonce')).body.nonce;
    const linked = await call(first.base, 'POST', '/account/providers', {
      token,
      body: { password: PW, provider: 'google', nonce, idToken: signToken(googleClaims(nonce, { sub: 'google-sub-boris', email: 'boris@gmail.test' })) },
    });
    assert.equal(linked.status, 200);
    await first.stop();

    const second = await serve(createStore({ pool: db.pool, pinPepper: PEPPER }));
    try {
      const byPassword = await call(second.base, 'POST', '/login', { body: { email: 'boris@example.test', password: PW, deviceId: 'BORIS_LAPTOP' } });
      assert.equal(byPassword.status, 401, 'пароль после привязки не входит и после перезапуска');
      const nonce2 = (await call(second.base, 'POST', '/auth/nonce')).body.nonce;
      const byGoogle = await call(second.base, 'POST', '/auth/provider/verify', {
        body: { provider: 'google', nonce: nonce2, idToken: signToken(googleClaims(nonce2, { sub: 'google-sub-boris', email: 'boris@gmail.test' })) },
      });
      assert.equal(byGoogle.body.status, 'linked', 'вход через Google работает');
      assert.equal(byGoogle.body.userId, linked.body.userId);
    } finally {
      await second.stop();
    }
  } finally {
    await db.close();
  }
});

dbTest('SD27: запасная почта хранится на базе; один адрес — один аккаунт', async () => {
  const db = await testDatabase();
  try {
    const first = await serve(createStore({ pool: db.pool, pinPepper: PEPPER }));
    const boris = await registerByEmail(first.base, first.srv, 'boris@example.test', 'Boris');
    const v = await providerSignIn(first.base, (n) => googleClaims(n));
    const anna = await call(first.base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'Anna.G' } });
    assert.equal(anna.status, 200);
    await first.stop();

    const direct = createStore({ pool: db.pool, pinPepper: PEPPER });
    assert.equal(await direct.backupEmailSave(boris.body.userId, 'backup@example.test', 0), 'ok');
    assert.equal(await direct.backupEmailSave(anna.body.userId, 'backup@example.test', 0), 'taken', 'адрес уже запасной у другого аккаунта');
    const afterRestart = createStore({ pool: db.pool, pinPepper: PEPPER });
    assert.deepEqual(await afterRestart.backupEmailGet(boris.body.userId), { email: 'backup@example.test', verified: true }, 'после перезапуска на месте');
    assert.equal(await direct.backupEmailRemove(boris.body.userId), true);
    assert.equal(await direct.backupEmailGet(boris.body.userId), null);
  } finally {
    await db.close();
  }
});

dbTest('SD28: отложенный вход хранится на базе и отменяется', async () => {
  const db = await testDatabase();
  try {
    const first = await serve(createStore({ pool: db.pool, pinPepper: PEPPER }));
    const boris = await registerByEmail(first.base, first.srv, 'boris@example.test', 'Boris');
    await first.stop();
    const direct = createStore({ pool: db.pool, pinPepper: PEPPER });
    const wait = { userId: boris.body.userId, deviceId: 'BORIS_TABLET', label: null, platform: null, activateAt: 1000, cancelHash: 'h', createdAt: 0 };
    assert.equal(await direct.deviceWaitCreate(wait), 'ok');
    assert.equal(await direct.deviceWaitCreate(wait), 'exists', 'второе ожидание для того же устройства не создаётся');
    assert.deepEqual(await createStore({ pool: db.pool, pinPepper: PEPPER }).deviceWaitsOf(boris.body.userId), [{ deviceId: 'BORIS_TABLET', activateAt: 1000, cancelHash: 'h' }]);
    assert.equal(await direct.deviceWaitDelete(boris.body.userId, 'BORIS_TABLET'), true);
    assert.equal(await direct.deviceWaitGet(boris.body.userId, 'BORIS_TABLET'), null);
  } finally {
    await db.close();
  }
});

dbTest('SD29: код отмены восстановления хранится на базе и сбрасывается', async () => {
  const db = await testDatabase();
  try {
    const first = await serve(createStore({ pool: db.pool, pinPepper: PEPPER }));
    const boris = await registerByEmail(first.base, first.srv, 'boris@example.test', 'Boris');
    await first.stop();
    const direct = createStore({ pool: db.pool, pinPepper: PEPPER });
    await direct.recoveryCancelSet(boris.body.userId, 'hash-1', 5000);
    assert.deepEqual(await createStore({ pool: db.pool, pinPepper: PEPPER }).recoveryCancelGet(boris.body.userId), { codeHash: 'hash-1', expiresAt: 5000 });
    await direct.recoveryCancelClear(boris.body.userId);
    assert.equal(await direct.recoveryCancelGet(boris.body.userId), null);
  } finally {
    await db.close();
  }
});

dbTest('SD30: открытый ключ устройства хранится на базе и отключается', async () => {
  const db = await testDatabase();
  try {
    const first = await serve(createStore({ pool: db.pool, pinPepper: PEPPER }));
    const boris = await registerByEmail(first.base, first.srv, 'boris@example.test', 'Boris');
    await call(first.base, 'POST', '/login', { body: { email: 'boris@example.test', password: PW, deviceId: 'BORIS_PHONE' } });
    await first.stop();
    const deviceKeyName = `${boris.body.userId}|BORIS_PHONE`;
    const direct = createStore({ pool: db.pool, pinPepper: PEPPER });
    const jwk = { kty: 'EC', crv: 'P-256', x: 'x-value', y: 'y-value' };
    await direct.signingKeySet(deviceKeyName, jwk, 0);
    assert.deepEqual(await createStore({ pool: db.pool, pinPepper: PEPPER }).signingKeyGet(deviceKeyName), jwk, 'после перезапуска на месте');
    assert.equal(await direct.signingKeyDelete(deviceKeyName), true);
    assert.equal(await direct.signingKeyGet(deviceKeyName), null);
  } finally {
    await db.close();
  }
});
