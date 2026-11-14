// Точка входа сервера: npm start. Настройки — из переменных окружения (см. .env.example).
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { migrate } from './migrate.js';
import { createStore } from './store.js';
import { createServer } from './server.js';
import { createSmtpMailer } from './mail-smtp.js';

/** Запускает сервер. pool = null — память (только для тестов и разработки). */
export async function startServer({ config, logger = createLogger({ level: config.logLevel }), pool = null }) {
  // Production must never fall back to process memory: accounts, sessions and MLS state
  // must remain durable across restarts and shared across server instances.
  if ((config.production === true || config.nodeEnv === 'production') && !pool) {
    throw new Error('production server requires PostgreSQL; refusing to start with the in-memory store');
  }
  let store;
  if (pool) {
    if (config.runMigrations) await migrate(pool, { logger });
    store = createStore({ pool, pinPepper: config.pinPepper });
  }
  const mailer = config.mailTransport === 'smtp'
    ? createSmtpMailer({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      requireTls: config.smtpRequireTls,
      user: config.smtpUser,
      password: config.smtpPassword,
      from: config.smtpFrom,
      logger,
    })
    : config.testUi
    ? { send: async (m) => { process.stdout.write(`[тестовое письмо] ${m.to} | ${m.subject} | ${m.text}\n`); } }
    : undefined;
  const app = createServer({
    pinPepper: config.pinPepper,
    docsSecret: config.docsSecret || null,
    testUi: config.testUi,
    store,
    trustProxy: config.trustProxy,
    filesDir: config.filesDir || null,
    quotaBytes: config.fileQuotaBytes ?? null,
    registrationMode: config.registrationMode,
    publicUrl: config.publicUrl,
    bodyLimit: config.bodyLimitBytes,
        requirePhone: config.requirePhone,
    mailer,
    devEmailCode: config.devEmailCode,
        smsEnabled: config.smsEnabled,
        phoneBlockedCountries: config.phoneBlockedCountries,
    phoneAllowedCountries: config.phoneAllowedCountries,
    logger,
  });
  app.server.requestTimeout = config.requestTimeoutMs;
  app.server.headersTimeout = Math.min(config.requestTimeoutMs, 60000);
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(config.port, config.host, resolve);
    const cleanupTimer = setInterval(() => {
      app.sweepExpired().catch(() => {});
    }, 10 * 60_000);
    cleanupTimer.unref();
  });
  const port = app.server.address().port;
  logger.info('server started', { port, environment: config.nodeEnv });
  if (config.devEmailCode) logger.warn('development email code is enabled: never use this in production', { environment: config.nodeEnv });
  let stopping = null;
  const stop = () => {
    stopping ??= (async () => {
      logger.info('shutting down');
      await new Promise((resolve) => app.server.close(resolve));
      if (pool) await pool.end();
      logger.info('stopped');
    })();
    return stopping;
  };
  return { server: app.server, port, stop };
}

// Запуск: node src/main.js
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  const logger = createLogger({ level: config.logLevel });
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
  try {
    const app = await startServer({ config, logger, pool });
    const shutdown = () => app.stop().then(() => process.exit(0), (error) => {
      logger.error('shutdown failed', { error: error.message });
      process.exit(1);
    });
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error('start failed', { error: error.message });
    await pool.end().catch(() => {});
    process.exit(1);
  }
}
