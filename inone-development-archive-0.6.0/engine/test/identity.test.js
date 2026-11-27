import { randomBytes } from 'node:crypto';
// Этап 1 модели аккаунта (спецификация IDENTITY_MODEL_2026-10-21.md):
// регистрация по почте с кодом, одноразовый токен, никнейм, поиск по нику, лимиты.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createMemoryStore } from '../src/store-memory.js';
import { hashPassword } from '../src/account-rules.js';
import { hashPin } from '../src/pin-security.js';
import { freshEmailCode, requestEmailCode, checkEmailCode, useEmailToken } from '../src/email-code-rules.js';

const PEPPER = randomBytes(24).toString('hex');
const HOUR = 3600_000;
const PW = 'длинный-пароль-1';
const TEST_PIN = '80421697';
let phoneSequence = 1;
const testPhone = () => `+3747700${String(phoneSequence++).padStart(4, '0')}`;

async function start(extra = {}) {
  const srv = createServer({ defaultOrgAutoJoin: true, pinPepper: PEPPER, ...extra });
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

/** Код из письма о подтверждении почты. */
function codeFor(srv, email) {
  const mail = srv.mailbox(email).filter((m) => m.templateId === 'registration_code').at(-1);
  return mail.text.match(/\b(\d{6})\b/)[1];
}

/** Регистрация по почте целиком: письмо с кодом, токен, аккаунт. */
async function registerByEmail(base, srv, email, nickname, password = PW) {
  await call(base, 'POST', '/register/email', { body: { email, locale: 'ru' } });
  const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code: codeFor(srv, email) } });
  return call(base, 'POST', '/register', {
    body: { email, registrationToken: confirmed.body.registrationToken, password, nickname, phone: testPhone(), pin: TEST_PIN, pinConfirmation: TEST_PIN },
  });
}

test('I1: регистрация по почте — код на почту, неверный код не подтверждает, аккаунт уровня 1, вход по почте', async () => {
  const { srv, base, stop } = await start();
  try {
    await call(base, 'POST', '/register/email', { body: { email: 'anna@example.test', locale: 'ru' } });
    assert.equal(srv.mailbox('anna@example.test').at(-1).templateId, 'registration_code');
    const wrong = await call(base, 'POST', '/register/email/confirm', { body: { email: 'anna@example.test', code: '000000' } });
    assert.equal(wrong.status, 403, 'неверный код не даёт токен');
    const confirmed = await call(base, 'POST', '/register/email/confirm', {
      body: { email: 'anna@example.test', code: codeFor(srv, 'anna@example.test') },
    });
    assert.equal(confirmed.status, 200);
    const reg = await call(base, 'POST', '/register', {
      body: { email: 'anna@example.test', registrationToken: confirmed.body.registrationToken, password: PW, nickname: 'Anna.K', phone: testPhone(), pin: TEST_PIN, pinConfirmation: TEST_PIN },
    });
    assert.equal(reg.status, 200, 'регистрация с обязательными телефоном и PIN');
    assert.equal(reg.body.verificationLevel, 1);
    const login = await call(base, 'POST', '/login', { body: { email: 'anna@example.test', password: PW, deviceId: 'ANNA_PHONE' } });
    assert.equal(login.status, 200, 'вход по почте и паролю');
  } finally {
    await stop();
  }
});

test('I2: код истекает через 10 минут, токен регистрации — через 30', async () => {
  const { srv, base, stop } = await start();
  try {
    await call(base, 'POST', '/register/email', { body: { email: 'anna@example.test', locale: 'ru' } });
    const code = codeFor(srv, 'anna@example.test');
    srv.advance(11 * 60_000);
    assert.equal((await call(base, 'POST', '/register/email/confirm', { body: { email: 'anna@example.test', code } })).status, 410, 'код старше 10 минут не принимается');

    await call(base, 'POST', '/register/email', { body: { email: 'anna@example.test', locale: 'ru' } });
    const fresh = codeFor(srv, 'anna@example.test');
    const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email: 'anna@example.test', code: fresh } });
    assert.equal(confirmed.status, 200);
    srv.advance(31 * 60_000);
    const late = await call(base, 'POST', '/register', {
      body: { email: 'anna@example.test', registrationToken: confirmed.body.registrationToken, password: PW, nickname: 'Anna.K', phone: testPhone(), pin: TEST_PIN, pinConfirmation: TEST_PIN },
    });
    assert.equal(late.status, 410, 'токен старше 30 минут не принимается');
  } finally {
    await stop();
  }
});

test('I3: одна подтверждённая почта — один аккаунт, повторный запрос кода не выдаёт письма', async () => {
  const { srv, base, stop } = await start();
  try {
    assert.equal((await registerByEmail(base, srv, 'anna@example.test', 'Anna.K')).status, 200);
    const again = await call(base, 'POST', '/register/email', { body: { email: 'anna@example.test', locale: 'ru' } });
    assert.equal(again.status, 202, 'ответ тот же, что и для новой почты');
    assert.equal(srv.mailbox('anna@example.test').length, 1, 'письмо на занятую почту не уходит');
    const [existingConfirm, unknownConfirm] = await Promise.all([
      call(base, 'POST', '/register/email/confirm', { body: { email: 'anna@example.test', code: '123456' } }),
      call(base, 'POST', '/register/email/confirm', { body: { email: 'nobody@example.test', code: '123456' } }),
    ]);
    assert.equal(existingConfirm.status, 404);
    assert.equal(unknownConfirm.status, 404);
    assert.deepEqual(existingConfirm.body, unknownConfirm.body, 'confirmation does not reveal whether the email is registered');
  } finally {
    await stop();
  }
});

test('I4: ник — правила формата, зарезервированные имена и уникальность без учёта регистра', async () => {
  const { srv, base, stop } = await start();
  try {
    await call(base, 'POST', '/register/email', { body: { email: 'anna@example.test', locale: 'ru' } });
    const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email: 'anna@example.test', code: codeFor(srv, 'anna@example.test') } });
    const token = confirmed.body.registrationToken;
    for (const bad of ['ab', 'a'.repeat(21), '1abc', 'ann..a', 'ann_', 'admin', 'Аня']) {
      const r = await call(base, 'POST', '/register', { body: { email: 'anna@example.test', registrationToken: token, password: PW, nickname: bad, phone: testPhone(), pin: TEST_PIN, pinConfirmation: TEST_PIN } });
      assert.equal(r.status, 400, `ник «${bad}» отклоняется`);
    }
    // Отклонённый ник не сжигает токен: тот же токен принимает правильный ник.
    assert.equal((await call(base, 'POST', '/register', { body: { email: 'anna@example.test', registrationToken: token, password: PW, nickname: 'Anna.K', phone: testPhone(), pin: TEST_PIN, pinConfirmation: TEST_PIN } })).status, 200);
    assert.equal((await registerByEmail(base, srv, 'boris@example.test', 'anna.k')).status, 409, 'ник занят без учёта регистра');
  } finally {
    await stop();
  }
});

test('I5: поиск по нику — точное совпадение без учёта регистра, почта не отдаётся, лимит поисков', async () => {
  const { srv, base, stop } = await start({ rateLimits: { searchPerAccount: [{ windowMs: HOUR, limit: 2 }] } });
  try {
    const anna = await registerByEmail(base, srv, 'anna@example.test', 'Anna.K');
    assert.equal((await registerByEmail(base, srv, 'boris@example.test', 'Boris')).status, 200);
    const login = await call(base, 'POST', '/login', { body: { email: 'boris@example.test', password: PW, deviceId: 'BORIS_PHONE' } });
    const token = login.body.token;
    const found = await call(base, 'GET', '/users/search?nickname=anna.k', { token });
    assert.equal(found.status, 200);
    assert.equal(found.body.userId, anna.body.userId);
    assert.equal(JSON.stringify(found.body).includes('anna@example.test'), false, 'почта в ответе не появляется');
    assert.equal((await call(base, 'GET', '/users/search?nickname=anna', { token })).status, 404, 'частичное совпадение не находит');
    assert.equal((await call(base, 'GET', '/users/search?nickname=anna.k', { token })).status, 429, 'после лимита поиск закрыт');
  } finally {
    await stop();
  }
});

test('I6: коды на одну почту приходят не чаще трёх раз в час', async () => {
  const { srv, base, stop } = await start();
  try {
    for (let i = 0; i < 3; i++) {
      assert.equal((await call(base, 'POST', '/register/email', { body: { email: 'anna@example.test', locale: 'ru' } })).status, 202);
    }
    assert.equal((await call(base, 'POST', '/register/email', { body: { email: 'anna@example.test', locale: 'ru' } })).status, 429);
    assert.equal(srv.mailbox('anna@example.test').length, 3, 'четвёртое письмо не уходит');
  } finally {
    await stop();
  }
});

test('I7: по умолчанию работает проверенная регистрация; старая регистрация по логину без почты не создаёт аккаунт', async () => {
  const { base, stop } = await start();
  try {
    const legacy = await call(base, 'POST', '/register', { body: { userId: '@alice:inone.test', password: PW } });
    assert.equal(legacy.status, 400, 'без почты и токена аккаунт не создаётся');
    assert.equal((await call(base, 'POST', '/register/email', { body: {} })).status, 400);
    assert.equal((await call(base, 'POST', '/login', { body: { userId: '@alice:inone.test', password: PW, deviceId: 'A_PHONE' } })).status, 401);
  } finally {
    await stop();
  }
});

test('I8: код и токен регистрации одноразовые', () => {
  const requested = requestEmailCode(freshEmailCode(), { nowMs: 0, codeHash: 'code-1' });
  const first = checkEmailCode(requested, { nowMs: 1, codeOk: true, tokenHash: 'token-1' });
  assert.equal(first.outcome, 'ok');
  assert.equal(checkEmailCode(first.next, { nowMs: 2, codeOk: true, tokenHash: 'token-2' }).outcome, 'none', 'код второй раз не принимается');
  const used = useEmailToken(first.next, { nowMs: 3, tokenOk: true });
  assert.equal(used.outcome, 'ok');
  assert.equal(useEmailToken(used.next, { nowMs: 4, tokenOk: true }).outcome, 'none', 'токен второй раз не принимается');
});

test('I9: registration and security emails follow the persisted in-app language', async () => {
  const { srv, base, stop } = await start();
  try {
    for (const locale of ['hy', 'ru', 'en']) {
      const email = `locale-${locale}@example.test`;
      const requested = await call(base, 'POST', '/register/email', { body: { email, locale } });
      assert.equal(requested.status, 202);
      const registrationMail = srv.mailbox(email).at(-1);
      assert.match(registrationMail.html, new RegExp(`<html lang="${locale}"`));
      assert.match(registrationMail.text, /\d{6}/);
      const code = registrationMail.text.match(/\d{6}/)[0];
      const confirmed = await call(base, 'POST', '/register/email/confirm', { body: { email, code } });
      assert.equal(confirmed.status, 200);
      const registered = await call(base, 'POST', '/register', {
        body: { email, registrationToken: confirmed.body.registrationToken, password: PW, nickname: `Locale${locale.toUpperCase()}`, phone: testPhone(), pin: TEST_PIN, pinConfirmation: TEST_PIN },
      });
      assert.equal(registered.status, 200);
      const login = await call(base, 'POST', '/login', { body: { email, password: PW, deviceId: `LOCALE_${locale}` } });
      assert.equal(login.status, 200);
      const token = login.body.token;
      const profile = await call(base, 'GET', '/profile', { token });
      assert.equal(profile.body.locale, locale);
      const changedLocale = locale === 'hy' ? 'ru' : locale === 'ru' ? 'en' : 'hy';
      const changed = await call(base, 'PATCH', '/profile/locale', { token, body: { locale: changedLocale } });
      assert.equal(changed.status, 200);
      assert.equal(changed.body.locale, changedLocale);
      assert.equal((await call(base, 'GET', '/profile', { token })).body.locale, changedLocale);
      assert.equal((await call(base, 'PATCH', '/profile/locale', { token, body: { locale: 'de' } })).status, 400);
      assert.equal((await call(base, 'PATCH', '/profile/locale', { token, body: {} })).status, 400);
      await call(base, 'POST', '/recovery/start', { body: { email } });
      const recoveryMessages = srv.mailbox(email).slice(-2);
      assert.equal(recoveryMessages.length, 2);
      assert.ok(recoveryMessages.every((message) => message.html.includes(`<html lang="${changedLocale}"`)));
    }
    assert.equal((await call(base, 'POST', '/register/email', { body: { email: 'invalid-locale@example.test', locale: 'de' } })).status, 400);
    assert.equal((await call(base, 'PATCH', '/profile/locale', { body: { locale: 'de' } })).status, 401);
  } finally {
    await stop();
  }
});


test('I10: login locale is persisted before identity-check security email is queued', async () => {
  const store = createMemoryStore({ pinPepper: PEPPER });
  await store.createVerifiedAccount({
    userId: '@login-locale', passwordHash: hashPassword(PW), pinHash: await hashPin(PEPPER, TEST_PIN),
    phoneE164: testPhone(), email: 'login-locale@example.test',
    nickname: 'LoginLocale', nowMs: Date.now(), locale: 'hy',
  });
  store.recoveryUpdate('@login-locale', (current) => ({
    next: {
      ...current,
      identityCheck: true,
      windowStartedAt: Date.now() - 49 * HOUR,
      windowKeyResetAt: Date.now() - 1,
    },
    result: null,
  }));
  const { srv, base, stop } = await start({ store });
  try {
    const login = await call(base, 'POST', '/login', {
      body: { email: 'login-locale@example.test', password: PW, deviceId: 'LOGIN_LOCALE_DEVICE', locale: 'ru' },
    });
    assert.equal(login.status, 202);
    assert.equal(login.body.status, 'identity_check_required');
    const messages = srv.mailbox('login-locale@example.test');
    assert.equal(messages.length, 2, 'expired recovery window and identity check each queue a security email');
    assert.ok(messages.every((message) => message.html.includes('<html lang="ru">')));
    assert.equal(store.profileGet('@login-locale').locale, 'ru');
  } finally {
    await stop();
  }
});

test('I11: unauthenticated recovery emails follow the active UI locale without changing profile preference', async () => {
  const store = createMemoryStore({ pinPepper: PEPPER });
  await store.createVerifiedAccount({
    userId: '@recovery-locale', passwordHash: hashPassword(PW), pinHash: await hashPin(PEPPER, TEST_PIN),
    phoneE164: testPhone(), email: 'recovery-locale@example.test',
    nickname: 'RecoveryLocale', nowMs: Date.now(), locale: 'hy',
  });
  const { srv, base, stop } = await start({ store });
  try {
    const started = await call(base, 'POST', '/recovery/start', {
      body: { email: 'recovery-locale@example.test', locale: 'ru' },
    });
    assert.equal(started.status, 202);
    const startMessages = srv.mailbox('recovery-locale@example.test');
    assert.equal(startMessages.length, 2);
    assert.ok(startMessages.every((message) => message.html.includes('<html lang="ru">')));
    assert.equal(store.profileGet('@recovery-locale').locale, 'hy');

    const recoveryCode = startMessages[0].text.match(/\b\d{6}\b/)?.[0];
    assert.ok(recoveryCode, 'recovery code is present in the localized email');
    const completed = await call(base, 'POST', '/recovery/complete', {
      body: {
        email: 'recovery-locale@example.test',
        code: recoveryCode,
        pin: TEST_PIN,
        newPassword: 'новый-длинный-пароль-2',
        locale: 'en',
      },
    });
    assert.equal(completed.status, 200);
    const completionMail = srv.mailbox('recovery-locale@example.test').at(-1);
    assert.match(completionMail.html, /<html lang="en">/);

    const cancelCode = completionMail.text.match(/\b\d{6}\b/g)?.at(-1);
    assert.ok(cancelCode, 'recovery cancellation code is present in the completion email');
    const cancelled = await call(base, 'POST', '/recovery/cancel-by-code', {
      body: { email: 'recovery-locale@example.test', code: cancelCode, locale: 'ru' },
    });
    assert.equal(cancelled.status, 200);
    const cancellationMail = srv.mailbox('recovery-locale@example.test').at(-1);
    assert.match(cancellationMail.html, /<html lang="ru">/);
    assert.equal(store.profileGet('@recovery-locale').locale, 'hy');
  } finally {
    await stop();
  }
});
