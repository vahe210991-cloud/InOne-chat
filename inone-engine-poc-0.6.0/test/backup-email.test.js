import { randomBytes } from 'node:crypto';
// Запасная почта (решение владельца): необязательна, подтверждается кодом, коды подтверждения действий идут на неё.
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

const SUBJECT_CODE = 'Подтверждение действия в InOne';
const SUBJECT_BACKUP = 'Подтверждение запасной почты InOne';
const SUBJECT_CHANGED = 'Запасная почта InOne изменена';

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

async function newGoogleAccount(base) {
  const nonce = await nonceOf(base);
  const v = await call(base, 'POST', '/auth/provider/verify', { body: { provider: 'google', idToken: signToken(googleClaims(nonce)), nonce } });
  return (await call(base, 'POST', '/register/provider', { body: { ticket: v.body.ticket, nickname: 'Anna.G' } })).body;
}

async function sessionOf(base, account, deviceId = 'ANNA_PHONE') {
  return (await call(base, 'POST', '/login', { body: { userId: account.userId, proof: account.proof, deviceId } })).body.token;
}

async function registerByEmail(base, srv, email, nickname) {
  await call(base, 'POST', '/register/email', { body: { email } });
  const code = srv.mailbox(email).filter((m) => m.subject === 'Код подтверждения InOne').at(-1).text.match(/Код: (\d{6})/)[1];
  const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code } });
  return call(base, 'POST', '/register', { body: { email, registrationToken: confirmed.body.registrationToken, password: PW, nickname } });
}

const loginByEmail = async (base, email, deviceId) =>
  (await call(base, 'POST', '/login', { body: { email, password: PW, deviceId } })).body.token;

/** Код из последнего письма с нужной темой в ящике. */
const codeOf = (srv, mailbox, subject) =>
  srv.mailbox(mailbox).filter((m) => m.subject === subject).at(-1).text.match(/Код: (\d{6})/)[1];

/** Подтверждение действия кодом: код приходит на тот ящик, который сейчас назначен для подтверждений. */
async function emailStepUp(base, srv, mailbox, token, action) {
  const started = await call(base, 'POST', '/stepup/email/start', { token, body: { action } });
  assert.equal(started.status, 202);
  const confirmed = await call(base, 'POST', '/stepup/email/confirm', { token, body: { action, code: codeOf(srv, mailbox, SUBJECT_CODE) } });
  assert.equal(confirmed.status, 200);
  return confirmed.body.stepupToken;
}

/** Добавление запасной почты: подтверждение действия кодом с основной почты, затем код с запасной. */
async function addBackup(base, srv, token, backupEmail, primary = 'anna@gmail.test') {
  const stepupToken = await emailStepUp(base, srv, primary, token, 'set-backup-email');
  const started = await call(base, 'POST', '/account/backup-email/start', { token, body: { email: backupEmail, stepupToken } });
  assert.equal(started.status, 202);
  const confirmed = await call(base, 'POST', '/account/backup-email/confirm', { token, body: { email: backupEmail, code: codeOf(srv, backupEmail, SUBJECT_BACKUP) } });
  assert.equal(confirmed.status, 200);
  return confirmed.body;
}

test('B1: запасная почта необязательна — регистрация через Google работает без неё, в профиле подсказка', async () => {
  const { base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    assert.equal(anna.verificationLevel, 2);
    const profile = await call(base, 'GET', '/profile', { token: await sessionOf(base, anna) });
    assert.equal(profile.body.backupEmail, null);
    assert.ok(profile.body.securityHints.includes('no_backup_email'), 'подсказка о запасной почте есть');
  } finally {
    await stop();
  }
});

test('B2: запасная почта подтверждается кодом на неё; подсказка пропадает; основная почта получает уведомление; код одноразовый', async () => {
  const { srv, base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const token = await sessionOf(base, anna);
    const stepupToken = await emailStepUp(base, srv, 'anna@gmail.test', token, 'set-backup-email');
    const started = await call(base, 'POST', '/account/backup-email/start', { token, body: { email: 'backup@example.test', stepupToken } });
    assert.equal(started.status, 202);
    assert.equal(srv.mailbox('anna@gmail.test').filter((m) => m.subject === SUBJECT_BACKUP).length, 0, 'код не уходит на основную почту');
    const code = codeOf(srv, 'backup@example.test', SUBJECT_BACKUP);
    assert.equal((await call(base, 'POST', '/account/backup-email/confirm', { token, body: { email: 'backup@example.test', code: '000000' } })).status, 403);
    const ok = await call(base, 'POST', '/account/backup-email/confirm', { token, body: { email: 'backup@example.test', code } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.backupEmail.email, 'backup@example.test');
    const profile = await call(base, 'GET', '/profile', { token });
    assert.equal(profile.body.securityHints.includes('no_backup_email'), false, 'подсказка о запасной почте пропала');
    assert.equal(profile.body.backupEmail.email, 'backup@example.test');
    assert.equal(srv.mailbox('anna@gmail.test').filter((m) => m.subject === SUBJECT_CHANGED).length, 1, 'основная почта знает об изменении');
    assert.equal((await call(base, 'POST', '/account/backup-email/confirm', { token, body: { email: 'backup@example.test', code } })).status, 404, 'код одноразовый');
  } finally {
    await stop();
  }
});

test('B3: запасная почта не совпадает с основной', async () => {
  const { base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const token = await sessionOf(base, anna);
    const r = await call(base, 'POST', '/account/backup-email/start', { token, body: { email: 'ANNA@gmail.test' } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /must differ/);
  } finally {
    await stop();
  }
});

test('B4: после добавления коды подтверждения действий приходят на запасную почту', async () => {
  const { srv, base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const token = await sessionOf(base, anna);
    await addBackup(base, srv, token, 'backup@example.test');
    const onPrimaryBefore = srv.mailbox('anna@gmail.test').filter((m) => m.subject === SUBJECT_CODE).length;
    assert.equal((await call(base, 'POST', '/stepup/email/start', { token, body: { action: 'remove-provider' } })).status, 202);
    assert.equal(srv.mailbox('anna@gmail.test').filter((m) => m.subject === SUBJECT_CODE).length, onPrimaryBefore, 'на основную почту код не пришёл');
    assert.equal(srv.mailbox('backup@example.test').filter((m) => m.subject === SUBJECT_CODE).length, 1, 'код пришёл на запасную');
  } finally {
    await stop();
  }
});

test('B5: один адрес — запасная почта одного аккаунта', async () => {
  const { srv, base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    await addBackup(base, srv, await sessionOf(base, anna), 'backup@example.test');
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const borisToken = await loginByEmail(base, 'boris@example.test', 'BORIS_PHONE');
    assert.equal((await call(base, 'POST', '/account/backup-email/start', { token: borisToken, body: { email: 'backup@example.test', password: PW } })).status, 202);
    const code = codeOf(srv, 'backup@example.test', SUBJECT_BACKUP);
    assert.equal((await call(base, 'POST', '/account/backup-email/confirm', { token: borisToken, body: { email: 'backup@example.test', code } })).status, 409);
  } finally {
    await stop();
  }
});

test('B6: удаление запасной почты требует подтверждения; после удаления подсказка возвращается', async () => {
  const { srv, base, stop } = await start();
  try {
    const anna = await newGoogleAccount(base);
    const token = await sessionOf(base, anna);
    await addBackup(base, srv, token, 'backup@example.test');
    assert.equal((await call(base, 'POST', '/account/backup-email/remove', { token, body: {} })).status, 403, 'без подтверждения не удаляется');
    const stepupToken = await emailStepUp(base, srv, 'backup@example.test', token, 'remove-backup-email');
    const removed = await call(base, 'POST', '/account/backup-email/remove', { token, body: { stepupToken } });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.backupEmail, null);
    assert.ok(removed.body.securityHints.includes('no_backup_email'), 'после удаления подсказка возвращается');
    assert.equal((await call(base, 'POST', '/account/backup-email/remove', { token, body: { stepupToken } })).status, 403, 'повтор не проходит');
  } finally {
    await stop();
  }
});

test('B7: запросы кода запасной почты не чаще пяти в час на аккаунт', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const token = await loginByEmail(base, 'boris@example.test', 'BORIS_PHONE');
    for (let i = 0; i < 5; i++) {
      assert.equal((await call(base, 'POST', '/account/backup-email/start', { token, body: { email: `backup${i}@example.test`, password: PW } })).status, 202);
    }
    assert.equal((await call(base, 'POST', '/account/backup-email/start', { token, body: { email: 'backup9@example.test', password: PW } })).status, 429);
  } finally {
    await stop();
  }
});
