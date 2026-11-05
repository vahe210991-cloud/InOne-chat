import { randomBytes } from 'node:crypto';
// Номера телефона любой страны: проверка по правилам страны, единый вид, регистрация без отправки SMS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { normalizePhone, CIS_COUNTRIES, DEFAULT_PHONE_COUNTRIES, GATED_PHONE_COUNTRIES } from '../src/phone-international.js';
import { createMemorySms } from '../src/sms.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const CAROL = '@carol:inone.test';
const DAVE = '@dave:inone.test';
const enc = encodeURIComponent;

/** Прямой запрос регистрации: возвращает код ответа. ChatClient.create не годится, он пропускает 409. */
async function registerRaw(base, userId, phone) {
  const r = await fetch(`${base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId, password: PW, phone }),
  });
  return r.status;
}

async function start(options = {}) {
  const db = await storeForTest(PEPPER);
  const sms = createMemorySms();
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: true, smsEnabled: false, sms, pinPepper: PEPPER, store: db?.store, ...options });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return { srv, base, sms, db, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('номера разных стран принимаются и приводятся к одному виду', () => {
  const samples = {
    '+37477123456': 'AM', '+79123456789': 'RU', '+14155552671': 'US', '+447911123456': 'GB', '+971501234567': 'AE',
    '+919876543210': 'IN', '+4915123456789': 'DE', '+5511912345678': 'BR', '+61412345678': 'AU', '+995555123456': 'GE', '+375291234567': 'BY',
  };
  for (const [number, expected] of Object.entries(samples)) {
    const r = normalizePhone(number);
    assert.ok(r.value, `${number} принят`);
    assert.equal(r.value.e164, number);
    assert.ok(r.value.country, `${expected}: страна определена`);
  }
  assert.equal(normalizePhone('+374 77 12-34-56').value.e164, '+37477123456');
  assert.equal(normalizePhone('0037477123456').value.e164, '+37477123456');
  assert.equal(normalizePhone('+7 (912) 345-67-89').value.e164, '+79123456789');
});

test('неверные и не мобильные номера отклоняются', () => {
  assert.match(normalizePhone('37477123456').error, /country code/, 'без плюса');
  assert.match(normalizePhone('+1 800 555 0199').error, /mobile/, 'бесплатная линия');
  assert.match(normalizePhone('+374 10 123456').error, /mobile/, 'стационарный номер Армении');
  assert.match(normalizePhone('+3741234').error, /not valid/, 'слишком короткий');
  assert.match(normalizePhone('+1 000 000 0000').error, /not valid/, 'несуществующий номер');
  assert.ok(normalizePhone(12345).error, 'не строка');
});

test('страна из списка блокировки отклоняется', () => {
  assert.match(normalizePhone('+37477123456', { blockedCountries: ['AM'] }).error, /not accepted yet/);
  assert.ok(normalizePhone('+79123456789', { blockedCountries: ['AM'] }).value);
});

test('регистрация без номера отклоняется, если номер обязателен', async () => {
  const { base, stop } = await start();
  try {
    await assert.rejects(ChatClient.create(base, ALICE, 'A_PHONE', PW), (e) => e.status === 400);
  } finally {
    await stop();
  }
});

test('номер любой страны сохраняется за аккаунтом, SMS не уходит, пока SMS не подключён', async () => {
  const { base, sms, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW, { phone: '+37477123456' });
    await ChatClient.create(base, BOB, 'B_PHONE', PW, { phone: '+14155552671' });
    assert.equal(sms.outbox.length, 0, 'ни одна SMS не отправлена');
  } finally {
    await stop();
  }
});

test('второй аккаунт с тем же номером не регистрируется', async () => {
  const { base, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW, { phone: '+37477123456' });
    assert.equal(await registerRaw(base, CAROL, '+37477123456'), 409);
    assert.equal(await registerRaw(base, CAROL, '+374 77 12-34-56'), 409, 'тот же номер в другой записи');
  } finally {
    await stop();
  }
});

test('попытки регистрации с одного номера ограничены: четвёртая отклоняется', async () => {
  const { base, stop } = await start();
  try {
    await ChatClient.create(base, ALICE, 'A_PHONE', PW, { phone: '+37477123456' });
    assert.equal(await registerRaw(base, BOB, '+37477123456'), 409);
    assert.equal(await registerRaw(base, CAROL, '+37477123456'), 409);
    assert.equal(await registerRaw(base, DAVE, '+37477123456'), 429);
  } finally {
    await stop();
  }
});

test('смена номера и подтверждение SMS недоступны, пока SMS не подключён', async () => {
  const { base, stop } = await start();
  try {
    const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW, { phone: '+37477123456' });
    await assert.rejects(alice.raw('POST', '/account/phone', { password: PW, phone: '+37410123456' }), (e) => e.status === 503);
    await assert.rejects(alice.raw('POST', '/account/phone/confirm', { code: '123456' }), (e) => e.status === 503);
  } finally {
    await stop();
  }
});

test('по умолчанию принимаются страны СНГ, Европы, США и Канады; Китай и остальные страны — нет', () => {
  const L = DEFAULT_PHONE_COUNTRIES;
  // СНГ
  assert.ok(normalizePhone('+37477123456', { allowedCountries: L }).value, 'Армения');
  assert.ok(normalizePhone('+79123456789', { allowedCountries: L }).value, 'Россия');
  assert.ok(normalizePhone('+375291234567', { allowedCountries: L }).value, 'Беларусь');
  assert.ok(normalizePhone('+77011234567', { allowedCountries: L }).value, 'Казахстан');
  // Грузия и Украина, по решению владельца
  assert.ok(normalizePhone('+995555123456', { allowedCountries: L }).value, 'Грузия');
  assert.ok(normalizePhone('+380501234567', { allowedCountries: L }).value, 'Украина');
  // Европа, включая британские владения (номер британского мобильного относится к Гернси)
  assert.ok(normalizePhone('+4915123456789', { allowedCountries: L }).value, 'Германия');
  assert.ok(normalizePhone('+447911123456', { allowedCountries: L }).value, 'Великобритания (GG)');
  assert.ok(normalizePhone('+41791234567', { allowedCountries: L }).value, 'Швейцария');
  // США и Канада
  assert.ok(normalizePhone('+14155552671', { allowedCountries: L }).value, 'США');
  assert.ok(normalizePhone('+14165551234', { allowedCountries: L }).value, 'Канада');
  // Китай закрыт до юридической проверки: по умолчанию не принимается
  assert.match(normalizePhone('+8613912345678', { allowedCountries: L }).error, /not supported yet/, 'Китай закрыт по умолчанию');
  assert.ok(GATED_PHONE_COUNTRIES.includes('CN'), 'Китай в закрытом списке');
  assert.ok(!DEFAULT_PHONE_COUNTRIES.includes('CN'), 'Китая нет в открытом списке');
  // После юридической проверки страну открывают добавлением в список
  assert.ok(normalizePhone('+8613912345678', { allowedCountries: [...L, 'CN'] }).value, 'Китай открыт добавлением в список');
  // Не в списке
  assert.match(normalizePhone('+5511912345678', { allowedCountries: L }).error, /not supported yet/, 'Бразилия пока не в списке');
  assert.match(normalizePhone('+971501234567', { allowedCountries: L }).error, /not supported yet/, 'ОАЭ пока не в списке');
  assert.match(normalizePhone('+919876543210', { allowedCountries: L }).error, /not supported yet/, 'Индия пока не в списке');
  assert.ok(DEFAULT_PHONE_COUNTRIES.includes('GG'), 'Гернси входит в список как британское владение');
  assert.ok(normalizePhone('+14155552671').value, 'без списка ограничения нет');
});

