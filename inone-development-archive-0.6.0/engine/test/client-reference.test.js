import { randomBytes } from 'node:crypto';
// Референсный клиент против движка: полный путь включения, подтверждения, одобрения, инвалидации, выключения,
// а также тестовые векторы подписи (для переноса на Dart, Swift, Kotlin и C#).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, createVerify, generateKeyPairSync, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from '../src/server.js';
import { BiometricClient, SoftwareSigner, STATES } from '../client-reference/biometric-client.mjs';

const PEPPER = randomBytes(24).toString('hex');
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
  const code = srv.mailbox(email).filter((m) => m.subject === 'Код подтверждения InOne').at(-1).text.match(/\b(\d{6})\b/)[1];
  const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code } });
  return call(base, 'POST', '/register', { body: { email, registrationToken: confirmed.body.registrationToken, password: PW, nickname } });
}

const loginRaw = (base, email, deviceId) => call(base, 'POST', '/login', { body: { email, password: PW, deviceId } });

test('V1: тестовые векторы подписи проверяются тем же алгоритмом, что движок', () => {
  const v = JSON.parse(readFileSync(new URL('../client-reference/vectors/biometric-vectors.json', import.meta.url), 'utf8'));
  const key = createPublicKey({ key: v.publicKey, format: 'jwk' });
  const check = (message, signature) =>
    createVerify('SHA256').update(message).verify({ key, dsaEncoding: 'der' }, Buffer.from(signature, 'base64url'));
  for (const p of v.positive) assert.equal(check(p.message, p.signature), true, p.name);
  for (const n of v.negative) assert.equal(check(
    `inone-stepup-v1|${n.input.userId}|${n.input.deviceId}|${n.input.action}|${n.input.nonce}`, n.signature), false, n.name);
});

test('C1: полный путь клиента — включить, подтвердить, одобрить новое устройство, инвалидация, переподключение, выключить', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const phoneToken = (await loginRaw(base, 'boris@example.test', 'BORIS_PHONE')).body.token;
    const userId = (await call(base, 'GET', '/profile', { token: phoneToken })).body.userId;
    const phone = new BiometricClient({ baseUrl: base, token: phoneToken, deviceId: 'BORIS_PHONE', userId });
    assert.equal(phone.describe(), STATES.OFF);
    assert.equal((await phone.enable({ password: PW })).status, 200);
    assert.equal(phone.describe(), STATES.ON);
    const g = await phone.grant('set-backup-email');
    assert.equal(g.ok, true);
    assert.equal((await call(base, 'POST', '/account/backup-email/start', { token: phoneToken, body: { email: 'backup@example.test', bioGrant: g.grant } })).status, 202);
    const asked = await loginRaw(base, 'boris@example.test', 'BORIS_TABLET');
    assert.equal(asked.status, 202);
    assert.equal((await phone.approveDevice(asked.body.approvalId, asked.body.code)).status, 200, 'одобрено с биометрией');
    const tablet = await call(base, 'POST', `/approvals/${asked.body.approvalId}/claim`, { body: { pollSecret: asked.body.pollSecret } });
    assert.ok(tablet.body.token, 'новое устройство получило доступ');
    phone.signer.invalidate();
    const broken = await phone.grant('set-backup-email');
    assert.equal(broken.reason, 'invalidated');
    assert.equal(phone.describe(), STATES.INVALIDATED);
    phone.reset();
    assert.equal((await phone.enable({ password: PW })).status, 200, 'включено заново с новым ключом');
    assert.equal((await phone.grant('set-backup-email')).ok, true);
    assert.equal((await phone.disable({ password: PW })).status, 200);
    assert.equal(phone.describe(), STATES.OFF);
    const laptop = await loginRaw(base, 'boris@example.test', 'BORIS_LAPTOP');
    assert.equal((await phone.approveDevice(laptop.body.approvalId, laptop.body.code)).status, 200, 'без биометрии одобрение идёт кодом');
  } finally {
    await stop();
  }
});

test('C2: подпись чужим ключом сервер отклоняет; клиент сообщает причину', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const token = (await loginRaw(base, 'boris@example.test', 'BORIS_PHONE')).body.token;
    const userId = (await call(base, 'GET', '/profile', { token })).body.userId;
    const phone = new BiometricClient({ baseUrl: base, token, deviceId: 'BORIS_PHONE', userId });
    await phone.enable({ password: PW });
    phone.signer = new SoftwareSigner();
    const bad = await phone.grant('set-backup-email');
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'confirm');
    assert.equal(bad.status, 403);
  } finally {
    await stop();
  }
});

test('C3: аккаунт с привязкой включает биометрию по коду с почты', async () => {
  const { srv, base, stop } = await start();
  try {
    const nonce = (await call(base, 'POST', '/auth/nonce')).body.nonce;
    const claims = { iss: 'https://accounts.google.com', aud: 'g-client.apps.googleusercontent.com', sub: 'google-sub-anna', email: 'anna@gmail.test', email_verified: true, nonce, iat: nowSec(), exp: nowSec() + 600 };
    const v = await call(base, 'POST', '/auth/provider/verify', { body: { provider: 'google', idToken: signToken(claims), nonce } });
    const anna = (await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'Anna.G' } })).body;
    const token = (await call(base, 'POST', '/login', { body: { userId: anna.userId, proof: anna.proof, deviceId: 'ANNA_PHONE' } })).body.token;
    const client = new BiometricClient({ baseUrl: base, token, deviceId: 'ANNA_PHONE', userId: anna.userId });
    assert.equal(client.shouldOffer((await call(base, 'GET', '/profile', { token })).body), true, 'при первом входе через провайдера предлагаем включить');
    assert.equal((await client.enable({})).status, 403, 'без кода не включается');
    assert.equal((await call(base, 'POST', '/stepup/email/start', { token, body: { action: 'enable-biometric' } })).status, 202);
    const code = srv.mailbox('anna@gmail.test').filter((m) => m.templateId === 'stepup_code').at(-1).text.match(/\b(\d{6})\b/)[1];
    const confirmed = await call(base, 'POST', '/stepup/email/confirm', { token, body: { action: 'enable-biometric', code } });
    assert.equal((await client.enable({ stepupToken: confirmed.body.stepupToken })).status, 200);
    assert.equal(client.describe(), STATES.ON);
    assert.equal(client.shouldOffer((await call(base, 'GET', '/profile', { token })).body), false, 'после включения предложения нет');
    assert.equal((await client.grant('set-backup-email')).ok, true);
  } finally {
    await stop();
  }
});

test('C4: отключение без подтверждения не проходит; клиент остаётся включённым', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const token = (await loginRaw(base, 'boris@example.test', 'BORIS_PHONE')).body.token;
    const userId = (await call(base, 'GET', '/profile', { token })).body.userId;
    const phone = new BiometricClient({ baseUrl: base, token, deviceId: 'BORIS_PHONE', userId });
    await phone.enable({ password: PW });
    assert.equal(phone.shouldOffer((await call(base, 'GET', '/profile', { token })).body), false, 'аккаунт только с почтой предложения не получает');
    assert.equal((await phone.disable({})).status, 403);
    assert.equal(phone.describe(), STATES.ON);
  } finally {
    await stop();
  }
});
