import { randomBytes } from 'node:crypto';
// Очистка истёкших данных (критерий версии 0.6.0): истёкшие токены, токены обновления и очередь удаляются;
// действующие остаются; повторная очистка ничего не удаляет; после очистки вход работает.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

const PEPPER = randomBytes(24).toString('hex');
const ROOM = '!expired:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * 3600_000;

test('истёкшие токены и очередь удаляются; действующие остаются; повторная очистка ничего не удаляет', async () => {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await alice.createRoom(ROOM, [ALICE, BOB]); // Боб получает сигнал о комнате и не забирает его
    srv.advance(16 * MIN);
    const first = await srv.sweepExpired();
    assert.ok(first.tokens >= 1, 'истёкшие токены доступа удалены');
    assert.equal(first.refreshTokens, 0, 'токены обновления ещё действуют');
    srv.advance(31 * DAY);
    const second = await srv.sweepExpired();
    assert.ok(second.refreshTokens >= 1, 'истёкшие токены обновления удалены');
    assert.ok(second.inbox >= 1, 'истёкший сигнал очереди удалён');
    const third = await srv.sweepExpired();
    assert.deepEqual([third.inbox, third.tokens, third.refreshTokens, third.authTokens, third.recoveryCancelCodes], [0, 0, 0, 0, 0], 'повторная очистка ничего не удаляет');
    await alice.renewSession();
    const config = await fetch(`${base}/config`, { headers: { authorization: `Bearer ${alice.token}` } });
    assert.equal(config.status, 200, 'после очистки вход работает');
  } finally {
    await new Promise((r) => srv.server.close(r));
    await db?.close();
  }
});


test('устаревшие rate-limit и login-throttle счётчики очищаются, активные окна и блокировки сохраняются', () => {
  const store = createMemoryStore({ pinPepper: PEPPER });
  const DAY = 24 * 60 * 60_000;
  const start = 1;
  const now = DAY + 1;

  store.rateHit('rate:stale', start, DAY, 10);
  store.rateHit('rate:active', now - 60 * 60_000, DAY, 10);

  const policy = {
    freeFailures: 0, baseDelayMs: 15 * 60_000, maxDelayMs: 15 * 60_000,
    sourceLimit: 30, sourceWindowMs: 10 * 60_000, sourceBlockMs: 10 * 60_000,
    notifyAfter: 5, notifyWindowMs: 15 * 60_000,
  };
  store.throttledLogin({
    pairKey: 'pair:stale', sourceKey: 'source:stale', loginKey: 'login:stale',
    now: start, verify: () => false, policy, notify: false,
  });
  store.throttledLogin({
    pairKey: 'pair:active', sourceKey: 'source:active', loginKey: 'login:active',
    now: now - 60_000, verify: () => false, policy, notify: false,
  });

  const removed = store.purgeExpired(now);
  assert.equal(removed.rateLimits, 1, 'устаревшее rate-limit окно удалено');
  assert.equal(removed.loginThrottle, 3, 'устаревшие pair/source/login записи удалены');
  assert.deepEqual(store.rateHit('rate:active', now, DAY, 10), {
    allowed: true, retryAt: now - 60 * 60_000 + DAY,
  }, 'активное rate-limit окно продолжает действовать');
  assert.equal(store.throttledLogin({
    pairKey: 'pair:active', sourceKey: 'source:active', loginKey: 'login:active',
    now, verify: () => false, policy, notify: false,
  }).status, 'throttled', 'активная login-блокировка сохранена');
  const repeated = store.purgeExpired(now);
  assert.equal(repeated.rateLimits, 0);
  assert.equal(repeated.loginThrottle, 0);
});

test('коды телефона, почты и восстановления очищаются по сроку; привязка телефона и состояние восстановления сохраняются', async () => {
  const store = createMemoryStore({ pinPepper: PEPPER });
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const MAIL = 'почта.очистка@example.test';
    store.phoneUpdate(ALICE, (p) => ({ next: { ...p, phone: '+37400123456', verified: true, codeHash: 'hash-phone', codeAttempts: 2, codeExpiresAt: 1 }, result: null }));
    store.emailCodeUpdate(MAIL, (c) => ({ next: { ...c, codeHash: 'hash-mail', codeAttempts: 1, codeExpiresAt: 1, tokenHash: 'hash-token', tokenExpiresAt: 1 }, result: null }));
    store.recoveryUpdate(ALICE, (r) => ({ next: { ...r, reqStatus: 'pending', reqStartedAt: 1, reqExpiresAt: 1, reqCodeHash: 'hash-reset', reqLinkHash: 'hash-link' }, result: null }));
    const cleared = store.clearExpiredCodes(Date.now());
    assert.equal(cleared.phoneCodes, 1, 'код телефона очищен');
    assert.ok(cleared.emailCodes >= 1, 'коды почты очищены');
    assert.equal(cleared.recoveryRequests, 1, 'секреты запроса восстановления очищены');
    const phone = store.phoneUpdate(ALICE, (p) => ({ next: p, result: p }));
    assert.equal(phone.codeHash, null, 'кода телефона больше нет');
    assert.equal(phone.phone, '+37400123456', 'привязка телефона сохранена');
    assert.equal(phone.verified, true, 'подтверждение телефона сохранено');
    const mail = store.emailCodeUpdate(MAIL, (c) => ({ next: c, result: c }));
    assert.equal(mail.codeHash, null, 'кода почты больше нет');
    assert.equal(mail.tokenHash, null, 'токена почты больше нет');
    const rec = store.recoveryGet(ALICE);
    assert.equal(rec.reqCodeHash, null, 'кода восстановления больше нет');
    assert.equal(rec.reqLinkHash, null, 'ссылки восстановления больше нет');
    assert.equal(rec.reqStatus, 'pending', 'состояние запроса восстановления сохранено');
  } finally {
    await new Promise((r) => srv.server.close(r));
  }
});

test('одобрения и приглашения удаляются через 30 дней после истечения, а не раньше', async () => {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW);
    await alice.createRoom(ROOM, [ALICE, BOB]);
    const invite = await fetch(`${base}/rooms/${encodeURIComponent(ROOM)}/invites`, { method: 'POST', headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ expiresInHours: 1 }) });
    assert.equal(invite.status, 200, 'приглашение создано');
    await ChatClient.loginFromNewDevice(base, BOB, PW, 'B_TAB', bob); // запрос на одобрение нового устройства
    srv.advance(2 * HOUR);
    const early = await srv.sweepExpired();
    assert.equal(early.invites, 0, 'приглашение истекло, но хранится 30 дней');
    assert.equal(early.approvals, 0, 'одобрение истекло, но хранится 30 дней');
    srv.advance(30 * DAY);
    const late = await srv.sweepExpired();
    assert.ok(late.invites >= 1, 'приглашение удалено через 30 дней после истечения');
    assert.ok(late.approvals >= 1, 'одобрение удалено через 30 дней после истечения');
  } finally {
    await new Promise((r) => srv.server.close(r));
    await db?.close();
  }
});
