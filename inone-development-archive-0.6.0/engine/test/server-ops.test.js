import { randomBytes } from 'node:crypto';
// Эксплуатация сервера: проверки здоровья, ограничение размера запроса, защитные заголовки, журнал без содержимого.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { ChatClient, DEFAULT_PASSWORD as PW } from '../src/client.js';
import { storeForTest } from './helpers.js';
import { createMemoryStore } from '../src/store-memory.js';

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

test('liveness remains healthy while PostgreSQL readiness is unavailable', async () => {
  const store = createMemoryStore({ pinPepper: PEPPER });
  store.ping = async () => { throw new Error('database outage sentinel'); };
  const { base, stop } = await start({ store });
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/readyz`)).status, 503);
  } finally {
    await stop();
  }
});

test('request logs retain only allowlisted route labels and never raw path, query or body', async () => {
  const entries = [];
  const logger = { debug() {}, warn() {}, error() {}, info: (msg, fields) => entries.push({ msg, ...fields }) };
  const { app, base, stop } = await start({ logger });
  const pathSecret = 'path-secret-sentinel-9834';
  const querySecret = 'query-secret-sentinel-2741';
  const bodySecret = 'body-secret-sentinel-6152';
  try {
    await fetch(`${base}/unmapped/${pathSecret}?token=${querySecret}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ arbitrarySecret: bodySecret }),
    });
    const line = entries.find((entry) => entry.msg === 'request');
    assert.equal(line.path, '/__other__');
    const dump = await app.dump();
    for (const secret of [pathSecret, querySecret, bodySecret]) assert.ok(!dump.includes(secret), `redacted ${secret}`);
  } finally {
    await stop();
  }
});

test('forwarded client IP is accepted only from an allowlisted immediate proxy and trusted chain', async () => {
  const store = createMemoryStore({ pinPepper: PEPPER });
  const hits = [];
  const originalRateHit = store.rateHit.bind(store);
  store.rateHit = async (...args) => { hits.push(args[0]); return originalRateHit(...args); };
  const { base, stop } = await start({
    store,
    trustProxy: true,
    trustedProxyIps: ['127.0.0.1', '192.0.2.10'],
  });
  try {
    const response = await fetch(`${base}/auth/nonce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9, 192.0.2.10' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.ok(hits.some((key) => key.includes('203.0.113.9')));
  } finally {
    await stop();
  }

  const untrustedStore = createMemoryStore({ pinPepper: PEPPER });
  const untrustedHits = [];
  const untrustedRateHit = untrustedStore.rateHit.bind(untrustedStore);
  untrustedStore.rateHit = async (...args) => { untrustedHits.push(args[0]); return untrustedRateHit(...args); };
  const untrusted = await start({ store: untrustedStore, trustProxy: true, trustedProxyIps: ['192.0.2.10'] });
  try {
    const response = await fetch(`${untrusted.base}/auth/nonce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.7' },
      body: '{}',
    });
    assert.equal(response.status, 200);
    assert.ok(untrustedHits.some((key) => key.includes('127.0.0.1')));
    assert.ok(!untrustedHits.some((key) => key.includes('198.51.100.7')));
  } finally {
    await untrusted.stop();
  }
});

test('global request boundary catches failures before body parsing and returns a stable error', async () => {
  const store = createMemoryStore({ pinPepper: PEPPER });
  store.flagOverrides = async () => { throw Object.assign(new Error('private database host sentinel'), { code: 'XX000' }); };
  const entries = [];
  const logger = { debug() {}, info() {}, warn() {}, error: (message, fields) => entries.push({ message, ...fields }) };
  const { base, stop } = await start({ store, logger });
  try {
    const response = await fetch(`${base}/auth/nonce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'internal server error' });
    assert.ok(!JSON.stringify(entries).includes('private database host sentinel'));
    assert.equal(entries.at(-1)?.errorCode, 'XX000');
  } finally {
    await stop();
  }
});
