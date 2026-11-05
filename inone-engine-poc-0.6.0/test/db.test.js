import { randomBytes } from 'node:crypto';
// Проверки хранилища на реальной PostgreSQL. Запуск: DATABASE_URL=... npm run test:db
// Без DATABASE_URL тесты пропускаются. Каждый тест работает в своей схеме.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { testDatabase } from './helpers.js';

const dbTest = process.env.DATABASE_URL ? test : test.skip;
const PEPPER = randomBytes(24).toString('hex');
const ALICE = '@alice:inone.test';
const BOB = '@bob:inone.test';
const FREE = 5;
const lockDuration = (attempt) => 60_000 * 2 ** Math.min(Math.max(0, attempt - FREE), 20);

/** Проверка PIN-хэша в тестах: считает, сколько раз её реально вызвали. */
function countingCheck() {
  const counter = { calls: 0 };
  counter.check = (pin, stored) => {
    counter.calls += 1;
    return stored === `h:${pin}`;
  };
  return counter;
}

dbTest('DB1: параллельный перебор PIN не даёт лишних проверок', async () => {
  const db = await testDatabase();
  try {
    const store = createStore({ pool: db.pool, pinPepper: PEPPER });
    await store.addAccount(ALICE, 'x');
    await store.setPin(ALICE, 'h:246810');
    const counter = countingCheck();
    const now = 1_000_000;
    const wrong = Array.from({ length: 40 }, (_, i) => String(100_000 + i));
    const results = await Promise.all(wrong.map((pin) =>
      store.verifyPin(ALICE, pin, { now, free: FREE, lockDuration, check: counter.check })));
    assert.equal(counter.calls, FREE, 'реальных проверок ровно столько, сколько разрешено');
    assert.equal(results.filter((r) => r.reason === 'wrong').length, FREE);
    assert.equal(results.filter((r) => r.reason === 'locked').length, 40 - FREE);
    // Даже верный PIN во время блокировки не проверяется.
    const right = await store.verifyPin(ALICE, '246810', { now, free: FREE, lockDuration, check: counter.check });
    assert.equal(right.reason, 'locked');
    assert.equal(counter.calls, FREE);
  } finally {
    await db.close();
  }
});

dbTest('DB2: повтор одной отправки в гонке создаёт одну запись', async () => {
  const db = await testDatabase();
  try {
    const store = createStore({ pool: db.pool, pinPepper: PEPPER });
    const settled = await Promise.allSettled(Array.from({ length: 20 }, () =>
      store.recordSend(`${ALICE}|A_PHONE`, 'm.room_key', 'txn-1', 1)));
    assert.equal(settled.filter((s) => s.status === 'rejected').length, 0, 'ошибок быть не должно');
    assert.equal(settled.filter((s) => s.status === 'fulfilled' && s.value).length, 1, 'принята ровно одна отправка');
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM sends');
    assert.equal(rows[0].n, 1);
  } finally {
    await db.close();
  }
});

dbTest('DB3: параллельные запросы получают каждый одноразовый ключ не больше одного раза', async () => {
  const db = await testDatabase();
  try {
    const store = createStore({ pool: db.pool, pinPepper: PEPPER });
    await store.addAccount(ALICE, 'x');
    const dk = await store.addDevice(ALICE, 'A_PHONE');
    const keys = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`signed_curve25519:k${i}`, { key: `v${i}` }]));
    await store.addOneTimeKeys(dk, keys);
    const settled = await Promise.allSettled(Array.from({ length: 20 }, () => store.claimOneTimeKey(dk)));
    assert.equal(settled.filter((s) => s.status === 'rejected').length, 0, 'ошибок быть не должно');
    const given = settled.filter((s) => s.status === 'fulfilled' && s.value).map((s) => Object.keys(s.value)[0]);
    assert.equal(given.length, 5, 'выданы все пять ключей и только они');
    assert.equal(new Set(given).size, 5, 'ни один ключ не выдан дважды');
  } finally {
    await db.close();
  }
});

dbTest('DB4: очередь: подтверждение одного потока не трогает другой, повтор заменяет запись, истёкшее не отдаётся', async () => {
  const db = await testDatabase();
  try {
    const store = createStore({ pool: db.pool, pinPepper: PEPPER });
    await store.addAccount(BOB, 'x');
    const dk = await store.addDevice(BOB, 'B_PHONE');
    const NOW = 1_000_000;
    const LATER = NOW + 10_000_000;
    await store.enqueue(dk, 'to_device', { type: 'm.room_key', sender: ALICE, content: { n: 1 } }, null, LATER);
    await store.enqueue(dk, 'security', { kind: 'device_approval_requested' }, null, LATER);
    await store.enqueue(dk, 'to_device', { type: 'm.room_key', sender: ALICE, content: { n: 2 } }, null, LATER);
    await store.enqueue(dk, 'device_list', { userId: ALICE }, ALICE, LATER);
    await store.enqueue(dk, 'device_list', { userId: ALICE }, ALICE, LATER); // заменяет предыдущую запись
    await store.enqueue(dk, 'room', { roomId: '!r:inone.test' }, '!r:inone.test', LATER);
    await store.enqueue(dk, 'security', { kind: 'old' }, null, NOW - 1); // уже истекло
    // События доставки подтверждены до номера 3. Сигнал до этого номера не подтверждён и должен остаться.
    const first = await store.drainQueue(dk, 3, 0, NOW);
    assert.deepEqual(first.map((r) => r.stream), ['security', 'device_list', 'room']);
    assert.deepEqual(first[0].body, { kind: 'device_approval_requested' });
    assert.deepEqual(first[1].body, { userId: ALICE }, 'одна запись на пользователя');
    // Сигналы подтверждены: очередь пуста.
    assert.deepEqual(await store.drainQueue(dk, 3, Number.MAX_SAFE_INTEGER, NOW), []);
  } finally {
    await db.close();
  }
});

dbTest('DB5: токен входа в базе хранится только как ключевой хэш', async () => {
  const db = await testDatabase();
  try {
    const store = createStore({ pool: db.pool, pinPepper: PEPPER });
    await store.addAccount(ALICE, 'x');
    const dk = await store.addDevice(ALICE, 'A_PHONE');
    const session = await store.issueSession(dk, Date.now(), 60_000, 60_000);
    const raw = session.accessToken;
    const { rows } = await db.pool.query('SELECT t::text AS row FROM tokens t');
    assert.equal(rows.length, 1);
    assert.ok(!rows.some((r) => r.row.includes(raw)), 'открытого токена в таблице нет');
    assert.equal(await store.deviceKeyForToken(raw, Date.now()), dk, 'настоящий токен узнаёт своё устройство');
    assert.equal(await store.deviceKeyForToken('0'.repeat(32), Date.now()), null, 'чужой токен не подходит');
    const refresh = await db.pool.query('SELECT t::text AS row FROM refresh_tokens t');
    assert.ok(!refresh.rows.some((r) => r.row.includes(session.refreshToken)), 'токен обновления в базе только хэшем');
  } finally {
    await db.close();
  }
});

dbTest('DB6: код восстановления в базе хранится только как ключевой хэш', async () => {
  const db = await testDatabase();
  try {
    const store = createStore({ pool: db.pool, pinPepper: PEPPER });
    await store.addAccount(ALICE, 'x');
    await store.storeRecoveryCode(ALICE, '123456', 5);
    const { rows } = await db.pool.query('SELECT code_hash FROM recoveries');
    assert.notEqual(rows[0].code_hash, '123456', 'код открытым текстом не хранится');
    assert.equal(rows[0].code_hash.length, 64, 'хранится хэш');
    assert.equal(await store.checkRecoveryCode(ALICE, '123456'), true, 'верный код проходит');
    assert.equal(await store.checkRecoveryCode(ALICE, '654321'), false, 'неверный код не проходит');
  } finally {
    await db.close();
  }
});
