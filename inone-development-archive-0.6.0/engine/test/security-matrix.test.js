import { randomBytes } from 'node:crypto';
// Защита входа и ввода (пункт 1 приоритетов): неверный JSON не раскрывает детали разбора и пути сервера,
// ошибки несут те же защитные заголовки, что и успешные ответы, записать конфигурацию без входа нельзя,
// ответы не содержат хешей, паролей и секретов. Правила без отдельных тестов в этом файле отмечены в отчёте.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice:inone.test';
const JSON_HEADERS = { 'content-type': 'application/json' };
const SECRET_KEY = /hash|password|pin|secret|pepper|token_hash|salt/i;

async function http(base, method, p, { token, body, headers = {} } = {}) {
  const res = await fetch(base + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text };
}

function keysOf(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

async function start() {
  const db = await storeForTest(PEPPER);
  const srv = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, store: db?.store });
  await new Promise((resolve) => srv.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  const alice = await ChatClient.create(base, ALICE, 'A_PHONE', PW);
  return { srv, base, alice, stop: async () => { await new Promise((r) => srv.server.close(r)); await db?.close(); } };
}

test('неверный JSON отклоняется, и в ответе нет деталей разбора, путей и трассировки', async () => {
  const s = await start();
  try {
    const bad = await http(s.base, 'POST', '/login', { body: '{"userId": "x", "password": ', headers: JSON_HEADERS });
    assert.ok(bad.status >= 400 && bad.status < 500, `неверный JSON отклоняется клиентской ошибкой, получен ${bad.status}`);
    assert.ok(!/SyntaxError|Unexpected|at \w|\/home\/|node_modules|\.js:\d+/.test(bad.text), `в ответе есть внутренние детали: ${bad.text.slice(0, 120)}`);
  } finally {
    await s.stop();
  }
});

test('ошибки несут те же защитные заголовки, что и успешные ответы', async () => {
  const s = await start();
  try {
    const ok = await http(s.base, 'GET', '/config/public');
    const missing = await http(s.base, 'GET', '/такого-маршрута-нет');
    for (const [label, res] of [['успешный', ok], ['ошибочный', missing]]) {
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `${label}: nosniff`);
      assert.equal(res.headers.get('cache-control'), 'no-store', `${label}: no-store`);
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer', `${label}: no-referrer`);
    }
  } finally {
    await s.stop();
  }
});

test('записать конфигурацию по сети нельзя: ни с входом, ни без входа', async () => {
  const s = await start();
  try {
    for (const [method, p] of [['PUT', '/config/groups.maxMembers'], ['POST', '/config'], ['PUT', '/admin/config/groups.maxMembers'], ['POST', '/config/groups.maxMembers']]) {
      const anon = await http(s.base, method, p, { body: JSON.stringify({ value: 2 }), headers: JSON_HEADERS });
      assert.ok([404, 405].includes(anon.status), `${method} ${p} без входа: ${anon.status}`);
      const authed = await http(s.base, method, p, { token: s.alice.token, body: JSON.stringify({ value: 2 }), headers: JSON_HEADERS });
      assert.ok([404, 405].includes(authed.status), `${method} ${p} со входом: ${authed.status}`);
    }
    const flags = await http(s.base, 'GET', '/config', { token: s.alice.token });
    assert.equal(flags.json.flags['groups.maxMembers'], 500, 'значение не изменилось');
  } finally {
    await s.stop();
  }
});

test('ответы не содержат хешей, паролей и секретов: ни в профиле, ни в устройствах, ни в входе', async () => {
  const s = await start();
  try {
    const login = await http(s.base, 'POST', '/login', { body: JSON.stringify({ userId: ALICE, password: PW, deviceId: 'A_PHONE' }), headers: JSON_HEADERS });
    assert.equal(login.status, 200);
    const bodies = [login, await http(s.base, 'GET', '/profile', { token: s.alice.token }), await http(s.base, 'GET', '/devices/mine', { token: s.alice.token }), await http(s.base, 'GET', '/config', { token: s.alice.token })];
    for (const b of bodies) {
      const leaked = keysOf(b.json).filter((k) => SECRET_KEY.test(k));
      assert.deepEqual(leaked, [], `в ответе есть секретные поля: ${leaked.join(', ')}`);
      assert.ok(!SECRET_KEY.test(b.text.replace(/"(token|refreshToken)":"[^"]*"/g, '')), 'секретных значений нет в тексте ответа');
    }
  } finally {
    await s.stop();
  }
});
