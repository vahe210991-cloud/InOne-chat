import { randomBytes } from 'node:crypto';
// Лимиты запросов (D5): регистрации и восстановление с одного адреса, SMS на один номер в сутки.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { createVerified } from './recovery-helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const HOUR = 3600_000;
const DAY = 24 * HOUR;

async function start(extra = {}) {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', pinPepper: PEPPER, ...extra });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: () => new Promise((r) => srv.server.close(r)) };
}

const requestRecovery = (base, userId) => fetch(`${base}/recovery/start`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }),
});

/** Сколько SMS с кодом восстановления ушло на номер. */
const recoverySms = (srv, phone) => srv.smsOutbox(phone).filter((m) => m.text.includes('Код восстановления')).length;

test('регистрации с одного адреса ограничены: лишние получают отказ, после окна лимит снимается', async () => {
  const { srv, base, stop } = await start({
    requirePhone: false,
    rateLimits: { registrationsPerAddress: [{ windowMs: HOUR, limit: 2 }] },
  });
  try {
    await ChatClient.create(base, '@a1:inone.test', 'D1', PW);
    await ChatClient.create(base, '@a2:inone.test', 'D2', PW);
    await assert.rejects(ChatClient.create(base, '@a3:inone.test', 'D3', PW), (e) => e.status === 429, 'третья регистрация с адреса отклоняется');
    srv.advance(HOUR + 1000);
    await ChatClient.create(base, '@a3:inone.test', 'D3', PW);
  } finally {
    await stop();
  }
});

test('запросы восстановления с одного адреса ограничены, в том числе по несуществующим аккаунтам', async () => {
  const { srv, base, stop } = await start({ rateLimits: { recoveryPerAddress: [{ windowMs: HOUR, limit: 2 }] } });
  try {
    await createVerified(base, srv, '@b1:inone.test', 'D1', PW, '+37477000011');
    await createVerified(base, srv, '@b2:inone.test', 'D2', PW, '+37477000012');
    assert.equal((await requestRecovery(base, '@b1:inone.test')).status, 202);
    assert.equal((await requestRecovery(base, '@b2:inone.test')).status, 202);
    assert.equal((await requestRecovery(base, '@nobody:inone.test')).status, 429, 'третий запрос с адреса отклоняется, даже по несуществующему аккаунту');
    assert.equal(recoverySms(srv, '+37477000011') + recoverySms(srv, '+37477000012'), 2, 'отклонённый запрос не шлёт SMS');
    srv.advance(HOUR + 1000);
    assert.equal((await requestRecovery(base, '@b1:inone.test')).status, 202, 'после окна запрос снова принимается');
  } finally {
    await stop();
  }
});

test('на один номер SMS приходят не чаще заданного за сутки, а номер чужого аккаунта SMS не получает', async () => {
  const PHONE = '+37477000021';
  const { srv, base, stop } = await start({ rateLimits: { smsPerPhone: [{ windowMs: DAY, limit: 2 }] } });
  try {
    const c1 = await ChatClient.create(base, '@c1:inone.test', 'D1', PW);
    const c2 = await ChatClient.create(base, '@c2:inone.test', 'D2', PW);
    await c1.raw('POST', '/account/phone', { password: PW, phone: PHONE });
    await c1.raw('POST', '/account/phone', { password: PW, phone: PHONE });
    await assert.rejects(c1.raw('POST', '/account/phone', { password: PW, phone: PHONE }), (e) => e.status === 429, 'третий SMS на тот же номер не отправляется');
    await assert.rejects(c2.raw('POST', '/account/phone', { password: PW, phone: PHONE }), (e) => e.status === 409, 'номер, закреплённый за другим аккаунтом, SMS не получает');
    assert.equal(srv.smsOutbox(PHONE).length, 2);
  } finally {
    await stop();
  }
});
