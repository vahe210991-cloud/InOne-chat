// Защита от перебора пароля при входе.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';

const ALICE = '@alice:inone.test';
const MINUTE = 60_000;

async function start() {
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: 'test-pepper-0123456789-0123456789-abcd' });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, stop: () => new Promise((r) => srv.server.close(r)) };
}

/** Серия попыток входа. Возвращает статусы ответов, как их видит любой наблюдатель. */
async function attempts(base, userId, passwords) {
  const statuses = [];
  for (const password of passwords) {
    try {
      await ChatClient.login(base, userId, password, 'DEV_X');
      statuses.push(200);
    } catch (e) {
      statuses.push(e.status);
    }
  }
  return statuses;
}

test('после трёх неверных паролей с одного адреса вход ждёт задержки, потом пускает (D7)', async () => {
  const { srv, base, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    assert.deepEqual(await attempts(base, ALICE, Array(3).fill('неверный-пароль')), [401, 401, 401]);
    assert.deepEqual(await attempts(base, ALICE, [PW]), [429], 'с того же адреса верный пароль ждёт задержки');
    srv.advance(MINUTE + 1000);
    assert.deepEqual(await attempts(base, ALICE, [PW]), [200]);
  } finally {
    await stop();
  }
});

test('для неизвестного логина ответы те же, что для существующего: по ним нельзя понять, есть ли аккаунт', async () => {
  const { base, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    const guesses = ['один', 'два', 'три', 'четыре', 'пять', PW];
    const known = await attempts(base, ALICE, guesses);
    const unknown = await attempts(base, '@nobody:inone.test', guesses);
    assert.deepEqual(unknown, known);
  } finally {
    await stop();
  }
});

test('блокировка растёт: вторая блокировка длиннее первой', async () => {
  const { srv, base, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW);
    await attempts(base, ALICE, Array(5).fill('неверный'));          // первая блокировка: 1 минута
    srv.advance(MINUTE + 1000);
    assert.deepEqual(await attempts(base, ALICE, ['неверный']), [401]); // одна попытка после паузы
    // после шестого промаха блокировка уже 2 минуты: через минуту ещё закрыто
    srv.advance(MINUTE + 1000);
    assert.deepEqual(await attempts(base, ALICE, [PW]), [429]);
    srv.advance(MINUTE + 1000);
    assert.deepEqual(await attempts(base, ALICE, [PW]), [200]);
  } finally {
    await stop();
  }
});

test('подтверждение восстановления уходит письмом со ссылкой, код — по SMS на подтверждённый телефон', async () => {
  const mailSent = [];
  const smsSent = [];
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open',
    requirePhone: false,
    pinPepper: 'test-pepper-0123456789-0123456789-abcd',
    mailer: { send: async (message) => { mailSent.push(message); } },
    sms: { send: async (phone, text) => { smsSent.push({ phone, text }); } },
  });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW, { phone: '+37477000001' });
    await alice.raw('POST', '/account/phone/confirm', { code: smsSent.at(-1).text.match(/\b(\d{6})\b/)[1] });
    await fetch(`${base}/recovery/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: ALICE }),
    });
    assert.equal(smsSent.at(-1).phone, '+37477000001');
    assert.match(smsSent.at(-1).text, /Код: \d{6}/);
    const mail = mailSent.at(-1);
    assert.equal(mail.to, ALICE);
    assert.match(mail.html, /<html lang="hy"/);
    assert.match(mail.text, /token=[A-Za-z0-9_-]+/);
    assert.doesNotMatch(mail.text, /Код: \d{6}/, 'в письме кода нет: код идёт по SMS');
  } finally {
    await new Promise((r) => srv.server.close(r));
  }
});
