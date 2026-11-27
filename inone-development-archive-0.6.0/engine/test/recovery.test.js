import { randomBytes } from 'node:crypto';
// Account recovery: verified-primary-email OTP + recovery PIN, 48-hour device safety window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, RECOVERY_DELAY_MS } from '../src/server.js';
import { createMemoryStore } from '../src/store-memory.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { createVerified, startRecovery, recoveryEmailCount, emailForUserId, TEST_PIN } from './recovery-helpers.js';

const FIXTURE_1 = randomBytes(16).toString('hex');
const FIXTURE_2 = randomBytes(16).toString('hex');
const FIXTURE_3 = randomBytes(16).toString('hex');
const ROOM = '!room2:inone.test';
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const PHONE_A = '+37477000001';
const PHONE_B = '+37477000002';
const NEW_PW = 'новый-пароль-2026';
const IDENTITY_SUBJECT = 'Подтверждение входа после восстановления';
const HOUR = 3600_000;

async function start({ store } = {}) {
  const pinPepper = 'test-pepper-0123456789-0123456789-abcd';
  const activeStore = store ?? createMemoryStore({ pinPepper });
  const srv = createServer({
    defaultOrgAutoJoin: true,
    registrationMode: 'open',
    requirePhone: false,
    pinPepper,
    store: activeStore,
  });
  srv.testStore = activeStore;
  srv.testPinPepper = pinPepper;
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: () => new Promise((r) => srv.server.close(r)) };
}

async function post(base, path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${path} -> ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

/** Вход без клиента: сервер может ответить просьбой ввести код из письма, а не токеном. */
const identityChallenges = new Map();

async function rawLogin(base, userId, password, deviceId, identityCode) {
  const key = `${userId}|${deviceId}`;
  const identityChallengeId = identityCode ? identityChallenges.get(key) : undefined;
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId,
      password,
      deviceId,
      ...(identityCode ? { identityCode } : {}),
      ...(identityCode && identityChallengeId ? { identityChallengeId } : {}),
    }),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (body.status === 'identity_check_required' && typeof body.challengeId === 'string') {
    identityChallenges.set(key, body.challengeId);
  } else if (res.status === 200 && identityCode) {
    identityChallenges.delete(key);
  }
  return { status: res.status, body };
}

/** Код входа после восстановления приходит письмом (D1). */
const identityCodeFrom = (srv, userId) => {
  const mail = srv.mailbox(emailForUserId(userId)).filter((m) => m.templateId === 'recovery_login_code' && /\b\d{6}\b/.test(m.text)).at(-1);
  return mail.text.match(/\b(\d{6})\b/)[1];
};

/** Number of recovery OTP emails sent to the verified primary address. */
const recoveryCodeCount = (srv, userId) => recoveryEmailCount(srv, emailForUserId(userId));

test('вход требует пароль: неверный пароль и неизвестный логин дают одинаковый отказ', async () => {
  const { base, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await assert.rejects(ChatClient.login(base, ALICE, 'неверный-пароль', 'A_X'), (e) => e.status === 401);
    await assert.rejects(ChatClient.login(base, '@nobody:inone.test', PW, 'A_X'), (e) => e.status === 401);
  } finally {
    await stop();
  }
});

test('отключённое устройство перестаёт работать и не может войти под своим идентификатором', async () => {
  const { base, stop } = await start();
  try {
    const phone = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const tablet = await ChatClient.loginFromNewDevice(base, ALICE, PW, 'A_TABLET', phone);
    await tablet.publishKeys();
    await phone.raw('DELETE', '/devices/A_TABLET');
    await assert.rejects(tablet.sync(), (e) => e.status === 401);
    await assert.rejects(ChatClient.login(base, ALICE, PW, 'A_TABLET'), (e) => e.status === 403);
  } finally {
    await stop();
  }
});

test('восстановление: новый пароль сразу; первый вход с нового устройства — по коду из письма; отмена со старого устройства', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const code = await startRecovery(base, srv, ALICE, PHONE_A);
    await assert.rejects(post(base, '/recovery/complete', { userId: ALICE, code: '000000', pin: TEST_PIN, newPassword: NEW_PW }), (e) => e.status === 403);
    await post(base, '/recovery/complete', { userId: ALICE, code, pin: TEST_PIN, newPassword: NEW_PW });

    // Старое устройство пока работает: отключаются они только через 48 часов.
    await phone.sync();
    assert.equal((await rawLogin(base, ALICE, PW, 'B_NEW')).status, 401, 'старый пароль больше не подходит');
    // Новый пароль на новом устройстве: сначала код из письма (D1).
    const first = await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    assert.equal(first.status, 202);
    assert.equal(first.body.status, 'identity_check_required');
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'B_NEW', '000000')).status, 403);
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'B_NEW', identityCodeFrom(srv, ALICE))).status, 200);

    // Отмена со старого устройства (D8): прежний пароль, новое устройство отключается.
    await phone.raw('POST', '/recovery/cancel');
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'C_X')).status, 401);
    assert.equal((await rawLogin(base, ALICE, PW, 'A_PHONE')).status, 200);
    assert.equal((await rawLogin(base, ALICE, PW, 'B_NEW')).status, 403, 'устройство, добавленное после запроса, отключено');
  } finally {
    await stop();
  }
});

test('через 48 часов после восстановления устройства, существовавшие до него, отключаются', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const code = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code, pin: TEST_PIN, newPassword: NEW_PW });
    await phone.sync();
    srv.advance(RECOVERY_DELAY_MS + 1000);
    await assert.rejects(phone.sync(), (e) => e.status === 401);
    assert.ok(srv.mailbox(emailForUserId(ALICE)).some((m) => m.templateId === 'old_devices_revoked'));
  } finally {
    await stop();
  }
});

test('устройство, появившееся после запроса восстановления, отменить не может', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const code = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code, pin: TEST_PIN, newPassword: NEW_PW });
    await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    const entered = await rawLogin(base, ALICE, NEW_PW, 'B_NEW', identityCodeFrom(srv, ALICE));
    const denied = await fetch(`${base}/recovery/cancel`, { method: 'POST', headers: { authorization: `Bearer ${entered.body.token}` } });
    assert.equal(denied.status, 403, 'новое устройство отменить не может');
    await phone.raw('POST', '/recovery/cancel');
    assert.equal((await rawLogin(base, ALICE, PW, 'A_PHONE')).status, 200);
  } finally {
    await stop();
  }
});

test('украденное старое устройство: после окна отключается и не читает новые сообщения', async () => {
  const { srv, base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const bob = await createVerified(base, srv, BOB, 'B_PHONE', PW, PHONE_B); // этот телефон украдут
    await bob.publishKeys();
    await alice.publishKeys();
    await alice.createRoom(ROOM, [ALICE, BOB]);
    await alice.addPeers([ALICE, BOB]);
    await alice.establishSessions([BOB]);
    await alice.shareRoomKey(ROOM, [ALICE, BOB]);
    await bob.sync();
    await alice.sendText(ROOM, 'до кражи');

    // Кража: Bob восстанавливает аккаунт и входит на новом устройстве по коду из письма.
    const code = await startRecovery(base, srv, BOB, PHONE_B);
    await post(base, '/recovery/complete', { userId: BOB, code, pin: TEST_PIN, newPassword: NEW_PW });
    await rawLogin(base, BOB, NEW_PW, 'B_NEW');
    const bobNew = await ChatClient.login(base, BOB, NEW_PW, 'B_NEW', { identityCode: identityCodeFrom(srv, BOB), identityChallengeId: identityChallenges.get(`${BOB}|B_NEW`) });
    // Пока окно открыто, новое устройство ничего не меняет: ключи не публикуются.
    await assert.rejects(bobNew.publishKeys(), (e) => e.status === 403);

    // Окно закрывается: старые устройства отключаются, новое публикует ключи и меняет ключ комнаты.
    srv.advance(RECOVERY_DELAY_MS + 1000);
    await bobNew.publishKeys();
    await bobNew.rotateRoom(ROOM, [ALICE, BOB]);

    await alice.sync();
    await alice.sendText(ROOM, 'после восстановления');
    await bobNew.sync();
    assert.equal((await bobNew.readText(ROOM)).at(-1).body, 'после восстановления');

    // Украденное устройство отключено: синхронизация не работает, новые сообщения не расшифровать.
    await assert.rejects(bob.sync(), (e) => e.status === 401);
    const copy = (await srv.roomEvents(ROOM)).at(-1);
    await assert.rejects(bob.decryptRaw(copy, ROOM));

    // Честно зафиксированное ограничение: сообщение, полученное до кражи, на украденном устройстве остаётся читаемым.
    assert.equal(await bob.decryptRaw((await srv.roomEvents(ROOM))[0], ROOM), 'до кражи');
  } finally {
    await stop();
  }
});

test('после пяти неверных кодов восстановление закрыто на час; новый код этого не обходит', async () => {
  const { srv, base, stop } = await start();
  try {
    await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    await startRecovery(base, srv, ALICE, PHONE_A);
    for (let i = 0; i < 5; i++) {
      await assert.rejects(post(base, '/recovery/complete', { userId: ALICE, code: '000000', pin: TEST_PIN, newPassword: NEW_PW }), (e) => e.status === 403);
    }
    await post(base, '/recovery/start', { email: emailForUserId(ALICE), locale: 'ru' });
    assert.equal(recoveryCodeCount(srv, ALICE), 1, 'во время блокировки новый email-код не выдаётся');
    srv.advance(HOUR + 1000);
    await post(base, '/recovery/start', { userId: ALICE, locale: 'ru' });
    assert.equal(recoveryCodeCount(srv, ALICE), 2, 'после часа email-код выдаётся снова');
  } finally {
    await stop();
  }
});

test('не больше трёх кодов восстановления в час', async () => {
  const { srv, base, stop } = await start();
  try {
    await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    for (let i = 0; i < 3; i++) {
      const code = await startRecovery(base, srv, ALICE, PHONE_A);
      await post(base, '/recovery/complete', { userId: ALICE, code, pin: TEST_PIN, newPassword: `пароль-${i}-2026` });
    }
    assert.equal(recoveryCodeCount(srv, ALICE), 3);
    await post(base, '/recovery/start', { userId: ALICE, locale: 'ru' });
    assert.equal(recoveryCodeCount(srv, ALICE), 3, 'четвёртый email-код за час не выдаётся');
  } finally {
    await stop();
  }
});

test('в окне восстановления старое устройство только читает и отменяет; второе новое устройство не добавляется', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const code = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code, pin: TEST_PIN, newPassword: NEW_PW });
    await phone.sync(); // читать можно
    await assert.rejects(phone.raw('POST', '/pin/reset/start', { password: PW }), (e) => e.status === 403, 'старое устройство в окне не меняет PIN');
    await assert.rejects(phone.raw('POST', '/keys/upload', {}), (e) => e.status === 403, 'старое устройство в окне не меняет ключи');

    // Первый вход по коду проходит; второе новое устройство в окне не добавляется.
    await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'B_NEW', identityCodeFrom(srv, ALICE))).status, 200);
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'C_NEW')).status, 403, 'второе новое устройство в окне не добавляется');

    // Отмена со старого устройства по-прежнему работает.
    await phone.raw('POST', '/recovery/cancel');
    assert.equal((await rawLogin(base, ALICE, PW, 'A_PHONE')).status, 200);
  } finally {
    await stop();
  }
});

test('устройство, добавленное во время окна, читает, но не меняет ничего и не отзывает; после окна работает как обычное', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const code = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code, pin: TEST_PIN, newPassword: NEW_PW });
    await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    const frozen = await ChatClient.login(base, ALICE, NEW_PW, 'B_NEW', { identityCode: identityCodeFrom(srv, ALICE), identityChallengeId: identityChallenges.get(`${ALICE}|B_NEW`) });

    await frozen.sync(); // читать можно
    await assert.rejects(frozen.raw('POST', '/pin/reset/start', { password: NEW_PW }), (e) => e.status === 403, 'PIN reset недоступен в recovery window');
    await assert.rejects(frozen.raw('POST', '/keys/upload', {}), (e) => e.status === 403, 'ключи не публикуются');
    await assert.rejects(frozen.raw('POST', '/keys/claim', {}), (e) => e.status === 403, 'ключи собеседников не забираются');
    await assert.rejects(frozen.raw('POST', '/rooms', { roomId: ROOM, members: [ALICE] }), (e) => e.status === 403, 'комнаты не создаются');
    await assert.rejects(frozen.raw('DELETE', '/devices/A_PHONE'), (e) => e.status === 403, 'устройства не отзываются');
    // Старое устройство в окне тоже ничего не отзывает; оно может только отменить восстановление (D8).
    await assert.rejects(phone.raw('DELETE', '/devices/B_NEW'), (e) => e.status === 403, 'старое устройство в окне не отзывает');
    await phone.raw('POST', '/recovery/cancel');
    await assert.rejects(frozen.sync(), (e) => e.status === 401);
  } finally {
    await stop();
  }
});

test('после окна устройство, добавленное в окне, работает как обычное', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const code = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code, pin: TEST_PIN, newPassword: NEW_PW });
    await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    const frozen = await ChatClient.login(base, ALICE, NEW_PW, 'B_NEW', { identityCode: identityCodeFrom(srv, ALICE), identityChallengeId: identityChallenges.get(`${ALICE}|B_NEW`) });
    srv.advance(RECOVERY_DELAY_MS + 1000);
    await frozen.raw('POST', '/pin/reset/start', { password: NEW_PW });
    await assert.rejects(phone.sync(), (e) => e.status === 401, 'старое устройство отключено');
  } finally {
    await stop();
  }
});

test('второе восстановление внутри окна не сдвигает окно и не меняет пароль, к которому откатывается отмена', async () => {
  const { srv, base, stop } = await start();
  try {
    const phone = await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const code1 = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code: code1, pin: TEST_PIN, newPassword: NEW_PW });
    await rawLogin(base, ALICE, NEW_PW, 'C_NEW');
    const added = await ChatClient.login(base, ALICE, NEW_PW, 'C_NEW', { identityCode: identityCodeFrom(srv, ALICE), identityChallengeId: identityChallenges.get(`${ALICE}|C_NEW`) });

    srv.advance(HOUR);
    const SECOND_PW = 'второй-пароль-2026';
    const code2 = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code: code2, pin: TEST_PIN, newPassword: SECOND_PW });

    // Устройство, добавленное в первом окне, по-прежнему ограничено.
    await assert.rejects(added.raw('DELETE', '/devices/A_PHONE'), (e) => e.status === 403);
    // Отмена со старого устройства возвращает пароль, который был до первого восстановления.
    await phone.raw('POST', '/recovery/cancel');
    assert.equal((await rawLogin(base, ALICE, PW, 'A_PHONE')).status, 200);
    assert.equal((await rawLogin(base, ALICE, SECOND_PW, 'X')).status, 401);
  } finally {
    await stop();
  }
});

test('регистрация без телефона отклоняется, если телефон обязателен', async () => {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: true, pinPepper: 'test-pepper-0123456789-0123456789-abcd' });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    await assert.rejects(ChatClient.create(base, ALICE, 'A_PHONE', PW, { phone: '' }), (e) => e.status === 400);
    await assert.rejects(ChatClient.create(base, ALICE, 'A_PHONE', PW, { phone: 'не-номер' }), (e) => e.status === 400);
  } finally {
    await new Promise((r) => srv.server.close(r));
  }
});

test('новое восстановление использует только OTP подтверждённой почты и PIN, без SMS и email-ссылки', async () => {
  const { srv, base, stop } = await start();
  try {
    await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    assert.equal(srv.smsOutbox(PHONE_A).length, 0, 'подтверждение телефона не требуется');
    const code = await startRecovery(base, srv, ALICE);
    assert.equal(recoveryCodeCount(srv, ALICE), 1, 'код доставлен на основную почту');
    await assert.rejects(
      post(base, '/recovery/complete', { userId: ALICE, code, pin: '00000000', newPassword: NEW_PW }),
      (error) => error.status === 403,
      'одного email-кода недостаточно без PIN',
    );
    await post(base, '/recovery/complete', { userId: ALICE, code, pin: TEST_PIN, newPassword: NEW_PW });
  } finally {
    await stop();
  }
});

test('аккаунт без подтверждённой основной почты не получает recovery OTP; телефон не заменяет email', async () => {
  const { srv, base, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW, { phone: PHONE_A });
    const response = await post(base, '/recovery/start', { email: emailForUserId(ALICE), locale: 'ru' });
    assert.equal(response.status, 202);
    assert.equal(recoveryCodeCount(srv, ALICE), 0);
    assert.equal(srv.smsOutbox(PHONE_A).length, 0);
  } finally {
    await stop();
  }
});

test('один телефон не может принадлежать двум аккаунтам и не является recovery-фактором', async () => {
  const { srv, base, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW, { phone: PHONE_A });
    const duplicate = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: BOB, password: PW, phone: PHONE_A, pin: TEST_PIN, pinConfirmation: TEST_PIN }),
    });
    assert.equal(duplicate.status, 409, 'регистрация с занятым номером отклоняется');
    const bob = await ChatClient.create(base, BOB, 'B_PHONE', PW, { phone: PHONE_B });
    await assert.rejects(bob.raw('POST', '/account/phone', { password: PW, phone: PHONE_A }), (error) => error.status === 409);
    assert.equal(srv.smsOutbox(PHONE_A).length, 0, 'номер не требует SMS-подтверждения');
  } finally {
    await stop();
  }
});

test('повторяет очистку устройств после частичного сбоя и закрывает окно только после успеха', async () => {
  const store = createMemoryStore({
    pinPepper: 'test-pepper-0123456789-0123456789-abcd',
  });
  const originalDrop = store.mlsDropDevicePackages.bind(store);
  let failOnce = true;
  store.mlsDropDevicePackages = async (...args) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('injected device cleanup failure');
    }
    return originalDrop(...args);
  };

  const { srv, base, stop } = await start({ store });
  try {
    const phone = await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const code = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code, pin: TEST_PIN, newPassword: NEW_PW });
    srv.advance(RECOVERY_DELAY_MS + 1000);

    await assert.rejects(phone.sync(), (error) => error.status === 500);
    const interrupted = await store.recoveryGet(ALICE);
    assert.notEqual(interrupted.windowKeyResetAt, null);
    assert.equal((await store.deviceRecord(`${ALICE}|A_PHONE`)).revoked, true);

    await assert.rejects(phone.sync(), (error) => error.status === 401, 'revoked device cannot retry finalization');
    // A fresh authenticated login retries the idempotent cleanup before issuing its identity challenge.
    const retry = await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    assert.equal(retry.status, 202);
    assert.equal(retry.body.status, 'identity_check_required');
    const completed = await store.recoveryGet(ALICE);
    assert.equal(completed.windowKeyResetAt, null);
    assert.ok(srv.mailbox(emailForUserId(ALICE)).some((mail) => mail.templateId === 'old_devices_revoked'));
  } finally {
    await stop();
  }
});

test('identity challenge is bound to the requesting device and resend is rate limited', async () => {
  const { srv, base, stop } = await start();
  try {
    await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const recoveryCode = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code: recoveryCode, pin: TEST_PIN, newPassword: NEW_PW });

    const first = await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    assert.equal(first.status, 202);
    assert.equal(first.body.status, 'identity_check_required');
    assert.equal(typeof first.body.challengeId, 'string');
    assert.equal(first.body.codeSent, true);
    const firstChallengeId = first.body.challengeId;
    const sentBefore = srv.mailbox(emailForUserId(ALICE)).filter((mail) => mail.templateId === 'recovery_login_code').length;

    const repeated = await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    assert.equal(repeated.status, 202);
    assert.equal(repeated.body.challengeId, firstChallengeId);
    assert.equal(repeated.body.codeSent, false);
    assert.equal(
      srv.mailbox(emailForUserId(ALICE)).filter((mail) => mail.templateId === 'recovery_login_code').length,
      sentBefore,
      'active challenge does not send duplicate email inside the cooldown',
    );

    const code = identityCodeFrom(srv, ALICE);
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'C_OTHER', code)).status, 403);
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'B_NEW', code)).status, 200);
  } finally {
    await stop();
  }
});

test('identity challenge expires and can be reissued after its resend cooldown', async () => {
  const { srv, base, stop } = await start();
  try {
    await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const recoveryCode = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code: recoveryCode, pin: TEST_PIN, newPassword: NEW_PW });

    const first = await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    const firstChallengeId = first.body.challengeId;
    srv.advance(10 * 60_000 + 1);
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'B_NEW', identityCodeFrom(srv, ALICE))).status, 410);

    const renewed = await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    assert.equal(renewed.status, 202);
    assert.equal(renewed.body.codeSent, true);
    assert.notEqual(renewed.body.challengeId, firstChallengeId);
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'B_NEW', identityCodeFrom(srv, ALICE))).status, 200);
  } finally {
    await stop();
  }
});

test('identity code attempts remain bounded across resend and lock the challenge', async () => {
  const { srv, base, stop } = await start();
  try {
    await createVerified(base, srv, ALICE, 'A_PHONE', PW, PHONE_A);
    const recoveryCode = await startRecovery(base, srv, ALICE, PHONE_A);
    await post(base, '/recovery/complete', { userId: ALICE, code: recoveryCode, pin: TEST_PIN, newPassword: NEW_PW });

    const first = await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    const actualCode = identityCodeFrom(srv, ALICE);
    const wrongCode = actualCode === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i++) {
      assert.equal((await rawLogin(base, ALICE, NEW_PW, 'B_NEW', wrongCode)).status, 403);
    }

    srv.advance(60_001);
    const resent = await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    assert.equal(resent.status, 202);
    assert.equal(resent.body.codeSent, true);
    assert.notEqual(resent.body.challengeId, first.body.challengeId);
    const renewedCode = identityCodeFrom(srv, ALICE);
    const wrongAfterResend = renewedCode === '000000' ? '000001' : '000000';

    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'B_NEW', wrongAfterResend)).status, 429);
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'B_NEW')).status, 429);

    srv.advance(HOUR + 1);
    const unlocked = await rawLogin(base, ALICE, NEW_PW, 'B_NEW');
    assert.equal(unlocked.status, 202);
    assert.equal(unlocked.body.codeSent, true);
    assert.equal((await rawLogin(base, ALICE, NEW_PW, 'B_NEW', identityCodeFrom(srv, ALICE))).status, 200);
  } finally {
    await stop();
  }
});
