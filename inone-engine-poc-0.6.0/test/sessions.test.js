import { randomBytes } from 'node:crypto';
// Жизненный цикл сессии: токен доступа живёт 15 минут; токен обновления одноразовый и живёт 30 дней;
// повтор старого токена обновления отзывает сессию устройства; выход завершает сессию.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const FIXTURE_1 = randomBytes(16).toString('hex');
const USER = '@sessia:inone.test';
const PASSWORD = FIXTURE_1;
const MIN = 60_000;
const DAY = 24 * 3600_000;

async function call(base, method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  await call(base, 'POST', '/register', null, { userId: USER, password: PASSWORD });
  const login = await call(base, 'POST', '/login', null, { userId: USER, password: PASSWORD, deviceId: 'S_PHONE' });
  return { srv, base, login: login.body, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('вход выдаёт токен доступа и токен обновления с датами; токен доступа работает', async () => {
  const s = await start();
  try {
    assert.ok(s.login.refreshToken, 'есть токен обновления');
    assert.ok(s.login.expiresAt && s.login.refreshExpiresAt, 'есть сроки действия');
    assert.equal((await call(s.base, 'GET', '/mls/key-packages/count', s.login.token)).status, 200);
  } finally {
    await s.stop();
  }
});

test('токен доступа истекает через 15 минут; обновление выдаёт новую пару, старый токен не воскресает', async () => {
  const s = await start();
  try {
    s.srv.advance(16 * MIN);
    const expired = await call(s.base, 'GET', '/mls/key-packages/count', s.login.token);
    assert.equal(expired.status, 401);
    assert.equal(expired.body.code, 'token_expired', 'истёкший токен получает отдельный ответ');
    const refreshed = await call(s.base, 'POST', '/token/refresh', null, { refreshToken: s.login.refreshToken });
    assert.equal(refreshed.status, 200);
    assert.equal((await call(s.base, 'GET', '/mls/key-packages/count', refreshed.body.token)).status, 200, 'новый токен работает');
    assert.equal((await call(s.base, 'GET', '/mls/key-packages/count', s.login.token)).body.code, 'token_expired', 'старый токен не воскрес');
  } finally {
    await s.stop();
  }
});

test('повтор старого токена обновления отзывает сессию устройства целиком', async () => {
  const s = await start();
  try {
    const first = await call(s.base, 'POST', '/token/refresh', null, { refreshToken: s.login.refreshToken });
    assert.equal(first.status, 200);
    assert.notEqual(first.body.refreshToken, s.login.refreshToken, 'токен обновления сменился (ротация)');
    const reused = await call(s.base, 'POST', '/token/refresh', null, { refreshToken: s.login.refreshToken });
    assert.equal(reused.status, 401);
    assert.equal(reused.body.code, 'refresh_reused', 'повтор распознан');
    assert.equal((await call(s.base, 'GET', '/mls/key-packages/count', first.body.token)).status, 401, 'новый токен доступа тоже отозван');
    assert.equal((await call(s.base, 'POST', '/token/refresh', null, { refreshToken: first.body.refreshToken })).status, 401, 'и токен обновления тоже');
  } finally {
    await s.stop();
  }
});

test('токен обновления истекает через 30 дней', async () => {
  const s = await start();
  try {
    s.srv.advance(31 * DAY);
    const r = await call(s.base, 'POST', '/token/refresh', null, { refreshToken: s.login.refreshToken });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'refresh_expired');
  } finally {
    await s.stop();
  }
});

test('выход завершает сессию: токены перестают работать', async () => {
  const s = await start();
  try {
    assert.equal((await call(s.base, 'POST', '/logout', s.login.token, {})).status, 200);
    assert.equal((await call(s.base, 'GET', '/mls/key-packages/count', s.login.token)).status, 401);
    assert.equal((await call(s.base, 'POST', '/token/refresh', null, { refreshToken: s.login.refreshToken })).status, 401);
  } finally {
    await s.stop();
  }
});
