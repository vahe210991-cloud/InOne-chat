import { randomBytes } from 'node:crypto';
// Биометрическое подтверждение (этап 2б, решение владельца): ключ устройства защищён биометрией на устройстве,
// сервер хранит открытый ключ и проверяет подпись на одноразовом вызове.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createServer } from '../src/server.js';

const PEPPER = randomBytes(24).toString('hex');
const PW = 'длинный-пароль-1';
const HOUR = 3600_000;

async function start() {
  const srv = createServer({ defaultOrgAutoJoin: true, pinPepper: PEPPER });
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
  const code = srv.mailbox(email).filter((m) => m.subject === 'Код подтверждения InOne').at(-1).text.match(/Код: (\d{6})/)[1];
  const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code } });
  return call(base, 'POST', '/register', { body: { email, registrationToken: confirmed.body.registrationToken, password: PW, nickname } });
}

const loginRaw = (base, email, deviceId) => call(base, 'POST', '/login', { body: { email, password: PW, deviceId } });

/** Ключ устройства: пара P-256. Закрытая часть остаётся у «устройства» в тесте. */
function deviceKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, jwk: publicKey.export({ format: 'jwk' }) };
}

/** Подпись сообщения устройством: так подпись делает Secure Enclave или Android Keystore с биометрией. */
const bioSign = (dev, userId, deviceId, action, nonce) =>
  createSign('SHA256').update(`inone-stepup-v1|${userId}|${deviceId}|${action}|${nonce}`).sign({ key: dev.privateKey, dsaEncoding: 'der' }).toString('base64url');

/** Биометрический грант: вызов, подпись, подтверждение. */
async function bioGrant(base, token, dev, userId, deviceId, action) {
  const ch = await call(base, 'POST', '/stepup/biometric/challenge', { token, body: { action } });
  assert.equal(ch.status, 200);
  const conf = await call(base, 'POST', '/stepup/biometric/confirm', { token, body: { challengeId: ch.body.challengeId, signature: bioSign(dev, userId, deviceId, action, ch.body.nonce) } });
  assert.equal(conf.status, 200);
  return conf.body.grant;
}

/** Аккаунт с паролем и включённой биометрией на первом устройстве. */
async function withBiometricPhone(base, srv) {
  const boris = await registerByEmail(base, srv, 'boris@example.test', 'Boris');
  const userId = boris.body.userId;
  const token = (await loginRaw(base, 'boris@example.test', 'BORIS_PHONE')).body.token;
  const phone = deviceKey();
  assert.equal((await call(base, 'POST', '/devices/signing-key', { token, body: { publicKey: phone.jwk, password: PW } })).status, 200);
  return { userId, token, phone };
}

test('G1: включить биометрию может только подтверждённый владелец: без пароля ключ не сохраняется', async () => {
  const { srv, base, stop } = await start();
  try {
    await registerByEmail(base, srv, 'boris@example.test', 'Boris');
    const token = (await loginRaw(base, 'boris@example.test', 'BORIS_PHONE')).body.token;
    const phone = deviceKey();
    assert.equal((await call(base, 'POST', '/devices/signing-key', { token, body: { publicKey: phone.jwk } })).status, 403, 'без пароля не включается');
    assert.equal((await call(base, 'POST', '/devices/signing-key', { token, body: { publicKey: { kty: 'EC', crv: 'P-384', x: 'a', y: 'b' }, password: PW } })).status, 400, 'только P-256');
    assert.equal((await call(base, 'POST', '/devices/signing-key', { token, body: { publicKey: phone.jwk, password: PW } })).status, 200);
    // Новое устройство ждёт одобрения и сессии не имеет: вызов подтверждения ему недоступен.
    const pending = await loginRaw(base, 'boris@example.test', 'BORIS_LAPTOP');
    assert.equal(pending.status, 202);
    assert.equal((await call(base, 'POST', '/stepup/biometric/challenge', { body: { action: 'set-backup-email' } })).status, 401);
  } finally {
    await stop();
  }
});

test('G2: подтверждённое биометрией действие проходит один раз; грант привязан к действию', async () => {
  const { srv, base, stop } = await start();
  try {
    const { userId, token, phone } = await withBiometricPhone(base, srv);
    const grant = await bioGrant(base, token, phone, userId, 'BORIS_PHONE', 'set-backup-email');
    const started = await call(base, 'POST', '/account/backup-email/start', { token, body: { email: 'backup@example.test', bioGrant: grant } });
    assert.equal(started.status, 202, 'грант для своего действия принят');
    const reused = await call(base, 'POST', '/account/backup-email/start', { token, body: { email: 'backup@example.test', bioGrant: grant } });
    assert.equal(reused.status, 403, 'грант одноразовый');
    const other = await bioGrant(base, token, phone, userId, 'BORIS_PHONE', 'set-backup-email');
    assert.equal((await call(base, 'POST', '/account/backup-email/remove', { token, body: { bioGrant: other } })).status, 403, 'грант для другого действия не принят');
  } finally {
    await stop();
  }
});

test('G3: неверная подпись отклоняется, и вызов сгорает', async () => {
  const { srv, base, stop } = await start();
  try {
    const { userId, token, phone } = await withBiometricPhone(base, srv);
    const ch = await call(base, 'POST', '/stepup/biometric/challenge', { token, body: { action: 'set-backup-email' } });
    const stranger = deviceKey();
    const bad = await call(base, 'POST', '/stepup/biometric/confirm', { token, body: { challengeId: ch.body.challengeId, signature: bioSign(stranger, userId, 'BORIS_PHONE', 'set-backup-email', ch.body.nonce) } });
    assert.equal(bad.status, 403, 'подпись чужим ключом не принимается');
    const good = await call(base, 'POST', '/stepup/biometric/confirm', { token, body: { challengeId: ch.body.challengeId, signature: bioSign(phone, userId, 'BORIS_PHONE', 'set-backup-email', ch.body.nonce) } });
    assert.equal(good.status, 403, 'после неверной попытки вызов сгорел');
  } finally {
    await stop();
  }
});

test('G4: вызов истекает через две минуты', async () => {
  const { srv, base, stop } = await start();
  try {
    const { userId, token, phone } = await withBiometricPhone(base, srv);
    const ch = await call(base, 'POST', '/stepup/biometric/challenge', { token, body: { action: 'set-backup-email' } });
    srv.advance(3 * 60_000);
    const late = await call(base, 'POST', '/stepup/biometric/confirm', { token, body: { challengeId: ch.body.challengeId, signature: bioSign(phone, userId, 'BORIS_PHONE', 'set-backup-email', ch.body.nonce) } });
    assert.equal(late.status, 403, 'старый вызов не принимается');
  } finally {
    await stop();
  }
});

test('G5: устройство с биометрией одобряет новое устройство только с подтверждением биометрией', async () => {
  const { srv, base, stop } = await start();
  try {
    const { userId, token, phone } = await withBiometricPhone(base, srv);
    const asked = await loginRaw(base, 'boris@example.test', 'BORIS_TABLET');
    assert.equal(asked.status, 202);
    assert.equal(asked.body.status, 'approval_required');
    const approve = `/approvals/${asked.body.approvalId}/approve`;
    assert.equal((await call(base, 'POST', approve, { token, body: { code: asked.body.code } })).status, 403, 'без биометрии одобрить нельзя');
    const grant = await bioGrant(base, token, phone, userId, 'BORIS_PHONE', 'approve-device');
    assert.equal((await call(base, 'POST', approve, { token, body: { code: asked.body.code, bioGrant: grant } })).status, 200, 'с биометрией одобрено');
    const claimed = await call(base, 'POST', `/approvals/${asked.body.approvalId}/claim`, { body: { pollSecret: asked.body.pollSecret } });
    assert.equal(claimed.body.status, 'approved');
    assert.ok(claimed.body.token, 'новое устройство получило доступ');
  } finally {
    await stop();
  }
});

test('G6: подтверждение, запрошенное одним устройством, не принимает другое устройство', async () => {
  const { srv, base, stop } = await start();
  try {
    const { userId, token, phone } = await withBiometricPhone(base, srv);
    const asked = await loginRaw(base, 'boris@example.test', 'BORIS_TABLET');
    await call(base, 'POST', `/approvals/${asked.body.approvalId}/approve`, { token, body: { code: asked.body.code, bioGrant: await bioGrant(base, token, phone, userId, 'BORIS_PHONE', 'approve-device') } });
    const tablet = (await call(base, 'POST', `/approvals/${asked.body.approvalId}/claim`, { body: { pollSecret: asked.body.pollSecret } })).body.token;
    const ch = await call(base, 'POST', '/stepup/biometric/challenge', { token, body: { action: 'set-backup-email' } });
    const relayed = await call(base, 'POST', '/stepup/biometric/confirm', { token: tablet, body: { challengeId: ch.body.challengeId, signature: bioSign(phone, userId, 'BORIS_PHONE', 'set-backup-email', ch.body.nonce) } });
    assert.equal(relayed.status, 403, 'чужое устройство не подтверждает');
  } finally {
    await stop();
  }
});

test('G7: отключить биометрию может только подтверждённый владелец; после отключения одобрение идёт кодом', async () => {
  const { srv, base, stop } = await start();
  try {
    const { token } = await withBiometricPhone(base, srv);
    assert.equal((await call(base, 'POST', '/devices/signing-key/remove', { token, body: {} })).status, 403, 'без подтверждения не отключается');
    assert.equal((await call(base, 'POST', '/devices/signing-key/remove', { token, body: { password: PW } })).status, 200);
    const asked = await loginRaw(base, 'boris@example.test', 'BORIS_LAPTOP');
    assert.equal((await call(base, 'POST', `/approvals/${asked.body.approvalId}/approve`, { token, body: { code: asked.body.code } })).status, 200, 'без ключа одобрение идёт кодом');
  } finally {
    await stop();
  }
});
