// Точка входа: сервер поднимается по настройкам, отвечает и останавливается без потери соединений.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/main.js';
import { createLogger } from '../src/logger.js';

const CONFIG = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  pinPepper: 'test-pepper-0123456789-0123456789-abcd',
  publicUrl: 'https://inone.test',
  registrationMode: 'open',
  trustProxy: false,
  bodyLimitBytes: 4 * 1024 * 1024,
  requestTimeoutMs: 30000,
  logLevel: 'error',
  runMigrations: false,
};

test('production не запускается без PostgreSQL и не использует память', async () => {
  await assert.rejects(
    startServer({ config: { ...CONFIG, nodeEnv: 'production', production: true }, logger: createLogger({ level: 'error', write: () => {} }) }),
    /production server requires PostgreSQL/,
  );
});

test('сервер поднимается, отвечает и останавливается', async () => {
  const app = await startServer({ config: CONFIG, logger: createLogger({ level: 'error', write: () => {} }) });
  const base = `http://127.0.0.1:${app.port}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  await app.stop();
  await assert.rejects(fetch(`${base}/healthz`));
});

test('повторная остановка безопасна', async () => {
  const app = await startServer({ config: CONFIG, logger: createLogger({ level: 'error', write: () => {} }) });
  await Promise.all([app.stop(), app.stop()]);
});
test('при отключённых миграциях сервер проверяет доступность PostgreSQL до открытия порта', async () => {
  const statements = [];
  let ended = false;
  const pool = {
    async query(sql) {
      statements.push(sql);
      return { rows: [{ '?column?': 1 }] };
    },
    async end() { ended = true; },
  };
  const app = await startServer({
    config: CONFIG,
    pool,
    logger: createLogger({ level: 'error', write: () => {} }),
  });
  assert.deepEqual(statements, ['SELECT 1']);
  await app.stop();
  assert.equal(ended, true);
});

test('сервер не открывает HTTP-порт, если PostgreSQL недоступен и миграции отключены', async () => {
  const pool = {
    async query() { throw new Error('database unavailable'); },
    async end() {},
  };
  await assert.rejects(
    startServer({
      config: CONFIG,
      pool,
      logger: createLogger({ level: 'error', write: () => {} }),
    }),
    /database unavailable/,
  );
});
