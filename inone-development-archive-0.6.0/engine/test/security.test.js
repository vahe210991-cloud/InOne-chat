import { randomBytes } from 'node:crypto';
import { createVerified, startRecovery } from './recovery-helpers.js';
// Вход с нового устройства, PIN и защита от перебора.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, APPROVAL_TTL_MS, FREE_PIN_ATTEMPTS, RECOVERY_DELAY_MS } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';

const ALICE = '@alice:inone.test';
const MINUTE = 60_000;
const PEPPER = randomBytes(24).toString('hex');

async function start() {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: () => new Promise((r) => srv.server.close(r)) };
}

async function call(base, method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

/** Начинает вход с нового устройства. Сервер отвечает запросом подтверждения. */
const beginNewDevice = (base, deviceId) =>
  call(base, 'POST', '/login', { userId: ALICE, password: PW, deviceId, label: deviceId, platform: 'test' });

const codeFrom = (srv, userId) =>
  srv.mailbox(userId).filter((m) => m.text.includes('Код восстановления')).at(-1).text.match(/\b(\d{6})\b/)[1];

test('вход с нового устройства ждёт подтверждения; три неверных кода отклоняют запрос', async () => {
  const { base, stop } = await start();
  try {
    const phone = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const r = await beginNewDevice(base, 'A_NEW');
    assert.equal(r.status, 'approval_required');
    assert.equal(r.token, undefined, 'токена до подтверждения быть не должно');
    for (let i = 0; i < 3; i++) {
      await assert.rejects(phone.approveDevice(r.approvalId, '000000'), (e) => e.status === 403);
    }
    // После трёх ошибок запрос отклонён: даже правильный код уже не работает.
    await assert.rejects(phone.approveDevice(r.approvalId, r.code), (e) => e.status === 404);
    const claim = await call(base, 'POST', `/approvals/${r.approvalId}/claim`, { pollSecret: r.pollSecret });
    assert.equal(claim.status, 'denied');
  } finally {
    await stop();
  }
});

test('правильный код: вход разрешается один раз, токен работает, владелец видит тревогу', async () => {
  const { base, stop } = await start();
  try {
    const phone = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const r = await beginNewDevice(base, 'A_NEW2');

    const pending = await phone.listApprovals();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].label, 'A_NEW2');
    assert.equal(pending[0].code, undefined, 'код на старом устройстве не показывается');

    await phone.approveDevice(r.approvalId, r.code);
    const claim = await call(base, 'POST', `/approvals/${r.approvalId}/claim`, { pollSecret: r.pollSecret });
    assert.equal(claim.status, 'approved');
    assert.ok(claim.token);
    await assert.rejects(
      call(base, 'POST', `/approvals/${r.approvalId}/claim`, { pollSecret: r.pollSecret }),
      (e) => e.status === 404,
      'результат забирается один раз',
    );

    const devs = await call(base, 'GET', '/devices', undefined, claim.token);
    assert.ok(devs.devices.some((d) => d.deviceId === 'A_NEW2'));

    await phone.sync();
    const kinds = phone.alerts.map((a) => a.kind);
    assert.ok(kinds.includes('device_approval_requested'));
    assert.ok(kinds.includes('device_approved'));
  } finally {
    await stop();
  }
});

test('чужой запрос на вход нельзя подтвердить', async () => {
  const { base, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const eve = await ChatClient.create(base, '@eve:inone.test', 'E_PHONE', PW);
    const r = await beginNewDevice(base, 'A_NEW3');
    await assert.rejects(eve.approveDevice(r.approvalId, r.code), (e) => e.status === 404);
  } finally {
    await stop();
  }
});

test('не больше трёх ожидающих запросов на вход', async () => {
  const { base, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    for (let i = 0; i < 3; i++) {
      assert.equal((await beginNewDevice(base, `X${i}`)).status, 'approval_required');
    }
    await assert.rejects(beginNewDevice(base, 'X9'), (e) => e.status === 429);
  } finally {
    await stop();
  }
});

test('запрос на вход истекает через 10 минут', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const r = await beginNewDevice(base, 'A_LATE');
    srv.advance(APPROVAL_TTL_MS + MINUTE);
    await assert.rejects(phone.approveDevice(r.approvalId, r.code), (e) => e.status === 404);
    const claim = await call(base, 'POST', `/approvals/${r.approvalId}/claim`, { pollSecret: r.pollSecret });
    assert.equal(claim.status, 'expired');
  } finally {
    await stop();
  }
});

test('PIN: слабый отклоняется; PIN не попадает на сервер открытым текстом; смена требует текущий PIN', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await assert.rejects(phone.setPin('123456'), (e) => e.status === 400);
    await phone.setPin('483920');
    assert.ok(!(await srv.dump()).includes('483920'), 'PIN не должен попасть в данные сервера');
    const stored = srv.pinStored(ALICE);
    assert.ok(stored && !stored.includes('483920'), 'в базе хранится хэш, а не PIN');
    await assert.rejects(phone.setPin('907314'), (e) => e.status === 403);
    await phone.setPin('907314', '483920');
    await phone.removePin('907314'); // новый PIN действует
  } finally {
    await stop();
  }
});

test('PIN: после неверных попыток блокировка; даже верный PIN в блокировке не проверяется', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await phone.setPin('483920');
    for (let i = 0; i < FREE_PIN_ATTEMPTS; i++) {
      await assert.rejects(phone.removePin('000001'), (e) => e.status === 403);
    }
    await assert.rejects(phone.removePin('483920'), (e) => e.status === 429);
    srv.advance(MINUTE + 1000);
    await phone.removePin('483920'); // после паузы верная попытка проходит
  } finally {
    await stop();
  }
});

test('параллельный перебор PIN: реальных проверок не больше порога', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await phone.setPin('483920');
    const before = srv.pinChecks();
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) => phone.removePin(String(100000 + i))),
    );
    const checks = srv.pinChecks() - before;
    assert.ok(checks <= FREE_PIN_ATTEMPTS, `реальных проверок: ${checks}`);
    assert.ok(results.filter((r) => r.status === 'rejected').length >= 30 - FREE_PIN_ATTEMPTS);
  } finally {
    await stop();
  }
});

test('восстановление требует PIN, если он задан, и PIN после него остаётся', async () => {
  const NEW_PW = 'новый-пароль-2026';
  const { srv, base, stop } = await start();
  try {
    const phone = await createVerified(base, srv, ALICE, 'A_PHONE', PW, '+37477000001');
    await phone.setPin('483920');
    const code = await startRecovery(base, srv, ALICE, '+37477000001');
    await assert.rejects(call(base, 'POST', '/recovery/complete', { userId: ALICE, code, newPassword: NEW_PW }), (e) => e.status === 403);
    await assert.rejects(call(base, 'POST', '/recovery/complete', { userId: ALICE, code, pin: '000001', newPassword: NEW_PW }), (e) => e.status === 403);
    await call(base, 'POST', '/recovery/complete', { userId: ALICE, code, pin: '483920', newPassword: NEW_PW });
    assert.ok(await srv.pinStored(ALICE), 'PIN не снимается восстановлением (D1)');
    await phone.sync(); // старое устройство живёт 48 часов (D8)
    srv.advance(RECOVERY_DELAY_MS + 1000);
    await assert.rejects(phone.sync(), (e) => e.status === 401);
  } finally {
    await stop();
  }
});
