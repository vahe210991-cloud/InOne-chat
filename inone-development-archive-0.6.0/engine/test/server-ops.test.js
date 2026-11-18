import { randomBytes } from 'node:crypto';
// Эксплуатация сервера: проверки здоровья, ограничение размера запроса, защитные заголовки, журнал без содержимого.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';

const PEPPER = randomBytes(24).toString('hex');
const FIXTURE_1 = randomBytes(16).toString('hex');

async function start(options = {}) {
  const app = createServer({ defaultOrgAutoJoin: true, registrationMode: 'open', requirePhone: false, pinPepper: PEPPER, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { app, base, stop: () => new Promise((r) => app.server.close(r)) };
}

test('проверка жизни и готовности отвечают без входа', async () => {
  const { base, stop } = await start();
  try {
    const live = await fetch(`${base}/healthz`);
    assert.equal(live.status, 200);
    assert.equal((await live.json()).status, 'ok');
    const ready = await fetch(`${base}/readyz`);
    assert.equal(ready.status, 200);
  } finally {
    await stop();
  }
});

test('готовность отвечает 503, если хранилище недоступно', async () => {
  const store = { ping: async () => { throw new Error('db down'); } };
  const { base, stop } = await start({ store });
  try {
    assert.equal((await fetch(`${base}/readyz`)).status, 503);
  } finally {
    await stop();
  }
});

test('слишком большое тело запроса отклоняется с 413', async () => {
  const { base, stop } = await start({ bodyLimit: 1024 });
  try {
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(4096) }),
    });
    assert.equal(response.status, 413);
  } finally {
    await stop();
  }
});

test('ответы несут защитные заголовки', async () => {
  const { base, stop } = await start();
  try {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  } finally {
    await stop();
  }
});

test('журнал запросов не содержит тело запроса и строку запроса', async () => {
  const entries = [];
  const logger = { debug() {}, warn() {}, error() {}, info: (msg, fields) => entries.push({ msg, ...fields }) };
  const { base, stop } = await start({ logger });
  try {
    await fetch(`${base}/auth/login?trace=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.test', password: FIXTURE_1 }),
    });
    const line = entries.find((e) => e.msg === 'request');
    assert.ok(line, 'запрос попал в журнал');
    assert.equal(line.path, '/auth/login');
    assert.equal(line.method, 'POST');
    assert.equal(typeof line.status, 'number');
    assert.ok(!JSON.stringify(entries).includes(FIXTURE_1));
    assert.ok(!JSON.stringify(entries).includes('trace=1'));
  } finally {
    await stop();
  }
});

test('неожиданная ошибка backend не раскрывает внутреннее сообщение клиенту', async (t) => {
  const db = await storeForTest(PEPPER);
  if (!db) {
    t.skip('DATABASE_URL is required for the persistent-store error-path test');
    return;
  }
  const entries = [];
  const logger = { debug() {}, info() {}, warn() {}, error: (message, fields) => entries.push({ message, ...fields }) };
  const { base, stop } = await start({ store: db.store, logger });
  try {
    const client = await ChatClient.create(base, '@safe-error-response:inone.test', 'ERROR_DEVICE', PW);
    const secretDetail = 'postgres-internal-host-and-query-detail';
    db.store.profileGet = async () => { throw Object.assign(new Error(secretDetail), { code: 'XX000' }); };
    const response = await fetch(`${base}/profile`, {
      headers: { authorization: `Bearer ${client.token}` },
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'internal server error' });
    assert.ok(!JSON.stringify(entries).includes(secretDetail));
    assert.equal(entries.at(-1)?.errorCode, 'XX000');
  } finally {
    await stop();
    await db.close();
  }
});

test('журнал запросов в памяти ограничен и не растёт без предела', async () => {
  const { app, base, stop } = await start({ wireLogLimit: 3 });
  try {
    for (let i = 0; i < 6; i += 1) {
      await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    }
    const { wireLog } = JSON.parse(await app.dump());
    assert.ok(wireLog.length <= 3, `журнал из ${wireLog.length} записей при лимите 3`);
    assert.ok(wireLog.length >= 1);
  } finally {
    await stop();
  }
});
